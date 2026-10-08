/**
 * cache/rule/schedule.ts -- periodic evaluation of the rule triggers that
 * can't be handled when a meter event arrives. Each of them fires when some
 * row's time passes a cutoff, so they share one shape: each rule keeps a
 * bookmark (rule_scheduler_state) of the last source row it read, and each
 * tick reads only the rows past it, a page at a time, in an order an index
 * already holds. Cost scales with rows that just became due, never with
 * total tenants or history.
 *
 *   - inactive_for reads tenant_last_activity by (meter, last activity):
 *     tenants whose last event is at least the rule's window ago, quietest
 *     first. pg trails ingest by up to a checkpoint, so each page is checked
 *     against the mlast: Redis keys before firing.
 *   - invoice_finalized / invoice_due / assignment_started read invoices (by
 *     finalized_at or due_at) and assignments (by starts_at), shifted by
 *     the rule's offset.
 *   - cycle_end reads billing_periods by period_end, shifted by the rule's
 *     offset. A negative offset fires before the billing period ends, as
 *     long as it's shorter than the billing cycle: a billing period's row
 *     only exists once it starts. Billing period boundaries are computed
 *     (assignment start + cycle length), which can't be indexed, so each
 *     billing period is written down as a row when it starts: creating the
 *     assignment adds the first (insertFirstPeriodReceipt), and
 *     advanceBillingPeriods adds each next one as the current one ends.
 *
 * Where a new rule starts reading depends on when it was created (see
 * startingCursorAtMicroseconds): it fires only for conditions met after its
 * creation. Conditions met before it (a rule created with backfill other
 * than "none") are recorded by the backfill job (cache/rule/backfill.ts),
 * which reads exactly the rows these bookmarks skip.
 *
 * Every API process runs this loop. Processes claim rules the way the
 * executor claims runs (a claimed_at lease), so they split the rules instead
 * of each doing all of them. Firing is deduped by a unique index on
 * rule_runs (rule, tenant, triggerKey), so re-reading a row never
 * double-fires.
 */
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  assignments,
  billingPeriods,
  invoices,
  meters,
  plans,
  rules,
  ruleSchedulerState,
  tenantLastActivity,
} from "../../db/schema.ts";
import type { FiringPayload, Rule } from "../../schemas/rule.ts";
import { redis } from "../index.ts";
import { keys } from "../keys.ts";
import {
  type BillingCycle,
  durationToMs,
  type Firing,
  forgetFiringQuota,
  getBillingCycles,
  recordFirings,
  SCHEDULED_TRIGGER_TYPES,
  takeFiringQuotaToken,
} from "./evaluate.ts";

/*
 * The scheduler's tick, one term in the firing-latency equation: worst-case
 * latency past a rule's due time ~= this interval + EXECUTOR_INTERVAL_MS +
 * the tick's own work. A quiet tick (nothing due) costs one claim and one
 * release per RULE_CLAIM_BATCH rules plus one indexed read per rule,
 * whatever the tenant count: measured at ~5ms for 10 rules, ~165ms for
 * 1,000, and ~0.8s for 5,000 (~0.16ms per live scheduled rule).
 *
 * An interval as tight as 10ms would be overrun by a quiet tick once there
 * are about 40 rules, so it would buy no latency. This one fits a quiet
 * tick for about 600 rules. Past that, the overlap guard skips beats when a
 * tick overruns instead of stacking them, so latency grows with the rule
 * count (see MAX_SCHEDULED_RULES).
 */
const SCHEDULER_INTERVAL_MS = 100;
/*
 * SCAN_PAGE_SIZE: how many rows one query reads for one rule (rows from
 * the table the rule watches: tenant_last_activity, invoices, assignments,
 * or billing_periods). SCAN_MAX_PAGES_PER_TICK: how many of those queries
 * one rule runs per tick. Rows past that wait for the next tick (the
 * bookmark keeps its place). Exported so a test can outgrow one tick's
 * budget.
 *
 * Why these values: SCAN_PAGE_SIZE keeps a page's Redis MGET, tenant
 * lookups, and rule_runs inserts to a few statements, each well within
 * pg's bind-parameter limit (see RULE_RUN_INSERT_BATCH).
 *
 * SCAN_MAX_PAGES_PER_TICK is the number we choose; the delay follows from
 * it. A full page that fires for every row takes ~180ms (measured; each
 * first firing in a firing quota window reads pg), so a backlogged rule's
 * pages take up to ~1.8s, and since each group of RULE_PASS_CONCURRENCY
 * passes waits for its slowest, every rule after it in that tick runs that
 * much later. In exchange, a backlogged rule drains SCAN_PAGE_SIZE x
 * SCAN_MAX_PAGES_PER_TICK rows per tick.
 */
export const SCAN_PAGE_SIZE = 1_000;
export const SCAN_MAX_PAGES_PER_TICK = 10;
/* Rules offered per claim statement. A claimed rule sits idle until a pass
 * slot frees up, so a small batch keeps claims close to when their passes
 * run (leaving the rest for other processes), while still claiming many
 * rules per round trip. */
const RULE_CLAIM_BATCH = 50;
/*
 * The most live scheduled rules createRule allows. This is the number we
 * choose; tick time follows from it. Every live scheduled rule adds
 * ~0.16ms to every quiet tick (measured locally, one process), so at this
 * cap a quiet tick takes ~0.8s, and a scheduled rule can fire up to that
 * late (plus SCHEDULER_INTERVAL_MS). The delay grows in proportion to the
 * cap: 10,000 rules would make it ~1.6s.
 */
export const MAX_SCHEDULED_RULES = 5_000;
/** Claim statements per tick: enough to offer every rule up to
 * MAX_SCHEDULED_RULES, RULE_CLAIM_BATCH at a time. */
const RULE_CLAIM_MAX_BATCHES_PER_TICK = Math.ceil(
  MAX_SCHEDULED_RULES / RULE_CLAIM_BATCH,
);
/** Rule passes one process runs at once: well under the pg pool size
 * (postgres-js defaults to 10 connections), leaving room for API requests. */
const RULE_PASS_CONCURRENCY = 4;
/*
 * A claim older than this was abandoned (its process died mid-pass) and is
 * reclaimable. Comfortably above the slowest realistic pass
 * (SCAN_MAX_PAGES_PER_TICK pages); a pass that outlives it is repeated
 * harmlessly, since bookmarks only move forward and firings dedupe.
 */
const RULE_CLAIM_LEASE_MS = 60_000;
/*
 * Tenants whose firing quota checks run at once while firing one page. A
 * check is a couple of Redis round trips, so one tenant at a time would make
 * a full page (SCAN_PAGE_SIZE tenants) wait on thousands of round trips in a
 * row. This many at once finishes a page in a handful of rounds. The first
 * check in a firing quota window also reads pg; those reads wait their turn
 * for a pg pool connection rather than opening more.
 */
const FIRING_QUOTA_CHECK_CONCURRENCY = 100;
/*
 * Ended billing periods advanced per page (one transaction; see
 * advanceBillingPeriods), and pages per tick: a bigger backlog carries
 * over to later ticks, and cycle_end detection waits for it (see
 * unadvancedFrontierMs).
 *
 * Why these values (measured locally): a full page of 1,000 takes ~50ms,
 * and its transaction holds those rows' locks that long, so creating an
 * assignment for one of those tenants waits up to ~50ms. Advancing runs
 * before every tick's rule passes, so a full tick of 10 pages (~490ms for
 * 10,000 billing periods) is the most a burst, like many billing periods
 * ending at the start of a month, delays them per tick. 100,000 ending at
 * once are all advanced within ~10 ticks (~5s).
 */
const ENDED_BILLING_PERIOD_PAGE_SIZE = 1_000;
const ENDED_BILLING_PERIOD_MAX_PAGES_PER_TICK = 10;

/*
 * Bookmarks store every position in microseconds. A bookmark has to be at least as
 * precise as the times it reads, or a rule can't pick up exactly after the
 * last row it read. Last-activity times are in microseconds (copies of
 * metering's event stamps). The other sources (invoices, assignments, billing
 * periods) are in ms and convert exactly: x MICROSECONDS_PER_MS to save a
 * position, / MICROSECONDS_PER_MS to compare one against an ms column.
 * Converting the other way (microseconds down to ms) would round, and a rule
 * would re-read rows from the same millisecond every time it picks up.
 * Exported for tests.
 */
export const MICROSECONDS_PER_MS = 1_000;

/** Where a rule's scan resumes: the (time, id) of the last row it read. */
type Bookmark = { cursorAtMicroseconds: number; cursorId: string };

/**
 * Where a new rule's scan starts. The scan skips anything older than this:
 * invoices finalized, assignments started, billing periods ended, or
 * tenants last active before it.
 *
 * A new rule should fire for everything that's due after the rule was
 * created, and nothing that was due before. Say a rule fires 3 days after
 * an invoice is finalized, and it's created today. An invoice finalized
 * yesterday is due in 2 days, so the rule should fire for it. An invoice
 * finalized a week ago was due 4 days ago, so it shouldn't. So the scan
 * starts 3 days before today: createdAt minus the offset.
 *
 * A negative offset flips this: a rule that fires 3 days before a billing
 * period ends starts its scan 3 days after createdAt, since a billing
 * period ending sooner than that was due before the rule existed.
 * inactive_for works the same way, with the rule's duration in place of
 * the offset.
 *
 * This uses createdAt rather than the current time because the bookmark
 * row can be written after the rule is created (see claimRules). Anything
 * older than this is left to the backfill job, if the rule has one.
 */
export function startingCursorAtMicroseconds({ rule }: { rule: Rule }): number {
  const trigger = rule.trigger;
  if (trigger.type === "relative_to_lifecycle_event") {
    return (
      (rule.createdAt - durationToMs(trigger.offset)) * MICROSECONDS_PER_MS
    );
  }
  if (trigger.type === "inactive_for") {
    return (
      (rule.createdAt - durationToMs(trigger.duration)) * MICROSECONDS_PER_MS
    );
  }
  return 0;
}

/** A rule claimed for one pass, with where its scan resumes. */
type ClaimedRule = { bookmark: Bookmark; rule: Rule };

/**
 * Claim rules for one pass, like the executor claims runs: a rule another
 * process claimed within RULE_CLAIM_LEASE_MS is skipped, so processes split
 * the rules instead of each doing all of them. The same upsert writes a
 * starting bookmark for any rule that has none yet (one inserted outside
 * createRule). Returns the claim stamp too, which releaseRules needs.
 */
async function claimRules({
  scheduledRules,
}: {
  scheduledRules: Rule[];
}): Promise<{ claimed: ClaimedRule[]; claimedAtMs: number }> {
  const claimedAtMs = Date.now();
  const rows = await db
    .insert(ruleSchedulerState)
    .values(
      scheduledRules.map((rule) => ({
        ruleId: rule.ruleId,
        cursorAtMicroseconds: startingCursorAtMicroseconds({ rule }),
        cursorId: "",
        claimedAt: claimedAtMs,
      })),
    )
    .onConflictDoUpdate({
      target: ruleSchedulerState.ruleId,
      set: { claimedAt: claimedAtMs },
      setWhere: sql`${ruleSchedulerState.claimedAt} is null or ${ruleSchedulerState.claimedAt} < ${claimedAtMs - RULE_CLAIM_LEASE_MS}`,
    })
    .returning();
  const ruleById = new Map(scheduledRules.map((rule) => [rule.ruleId, rule]));
  const claimed = rows.flatMap((row) => {
    const rule = ruleById.get(row.ruleId);
    if (rule === undefined) {
      return [];
    }
    return [
      {
        bookmark: {
          cursorAtMicroseconds: row.cursorAtMicroseconds,
          cursorId: row.cursorId,
        },
        rule,
      },
    ];
  });
  return { claimed, claimedAtMs };
}

/** Release a claim batch's rules, except any another process took over
 * after the lease lapsed mid-pass (their claim stamp changed). */
async function releaseRules({
  claimedAtMs,
  ruleIds,
}: {
  claimedAtMs: number;
  ruleIds: string[];
}): Promise<void> {
  await db
    .update(ruleSchedulerState)
    .set({ claimedAt: null })
    .where(
      and(
        inArray(ruleSchedulerState.ruleId, ruleIds),
        eq(ruleSchedulerState.claimedAt, claimedAtMs),
      ),
    );
}

/** Save a rule's bookmark, but only if it's ahead of the saved one. Two
 * processes can work on the same rule at once (a slow one whose claim
 * expired, and the one that claimed the rule next); this keeps the slow one
 * from moving the bookmark back behind rows the other already read. */
async function saveBookmark({
  bookmark,
  ruleId,
}: {
  bookmark: Bookmark;
  ruleId: string;
}): Promise<void> {
  await db
    .update(ruleSchedulerState)
    .set({
      cursorAtMicroseconds: bookmark.cursorAtMicroseconds,
      cursorId: bookmark.cursorId,
    })
    .where(
      and(
        eq(ruleSchedulerState.ruleId, ruleId),
        sql`(${ruleSchedulerState.cursorAtMicroseconds}, ${ruleSchedulerState.cursorId}) < (${bookmark.cursorAtMicroseconds}::bigint, ${bookmark.cursorId}::text)`,
      ),
    );
}

/*
 * Rows whose (time, id) sorts after the bookmark: one row comparison, so the
 * page read is a single seek into a (time, id) index. One version per unit
 * of the time column, so a scan can't compare its column in the wrong unit.
 */
function pastBookmarkMicroseconds({
  after,
  atMicroseconds,
  id,
}: {
  after: Bookmark;
  atMicroseconds: SQLWrapper;
  id: SQLWrapper;
}): SQL {
  return sql`(${atMicroseconds}, ${id}) > (${after.cursorAtMicroseconds}::bigint, ${after.cursorId}::text)`;
}

function pastBookmarkMs({
  after,
  atMs,
  id,
}: {
  after: Bookmark;
  atMs: SQLWrapper;
  id: SQLWrapper;
}): SQL {
  /* Positions from ms sources were saved × MICROSECONDS_PER_MS, so this
   * division is exact; rounding down could only re-read a row, never skip
   * one. */
  const afterMs = Math.floor(after.cursorAtMicroseconds / MICROSECONDS_PER_MS);
  return sql`(${atMs}, ${id}) > (${afterMs}::bigint, ${after.cursorId}::text)`;
}

/**
 * Walk a rule's source rows past its bookmark, a page at a time, saving the
 * bookmark after each page so a crash resumes at the last finished page.
 * The bookmark holds the last row's time AND id: with time alone, rows that
 * share a time are re-read every tick, and a run of them longer than a
 * tick's page budget is never passed.
 *
 * readPage should return every row it reads, even ones the rule won't
 * fire for, and let handlePage skip them. Each tick starts after the last
 * row readPage returned, so a row it read but left out gets read again
 * on every tick, until a later row is returned. (Filtering in SQL is fine
 * when the index skips those rows, like scanInactive's meter: Postgres
 * never reads them.)
 */
async function walkPages<Row>({
  bookmark,
  handlePage,
  positionOf,
  readPage,
  ruleId,
}: {
  bookmark: Bookmark;
  handlePage: ({ rows }: { rows: Row[] }) => Promise<void>;
  positionOf: ({ row }: { row: Row }) => Bookmark;
  readPage: ({ after }: { after: Bookmark }) => Promise<Row[]>;
  ruleId: string;
}): Promise<void> {
  let after = bookmark;
  for (let page = 0; page < SCAN_MAX_PAGES_PER_TICK; page++) {
    const rows = await readPage({ after });
    if (rows.length === 0) {
      return;
    }
    await handlePage({ rows });
    after = positionOf({ row: rows[rows.length - 1] });
    await saveBookmark({ bookmark: after, ruleId });
    if (rows.length < SCAN_PAGE_SIZE) {
      return;
    }
  }
}

/**
 * The page's tenants with an active assignment (started, and not ended) in
 * the rule's scope: one query bounded by the page, never every active
 * assignment.
 */
async function tenantsInScope({
  rule,
  tenantIds,
}: {
  rule: Rule;
  tenantIds: string[];
}): Promise<Set<string>> {
  const scope = rule.scope;
  const candidateIds =
    scope.kind === "tenant"
      ? tenantIds.filter((tenantId) => tenantId === scope.tenantId)
      : tenantIds;
  if (candidateIds.length === 0) {
    return new Set();
  }
  const now = Date.now();
  const rows = await db
    .select({ tenantId: assignments.tenantId })
    .from(assignments)
    .where(
      and(
        inArray(assignments.tenantId, candidateIds),
        lte(assignments.startsAt, now),
        or(isNull(assignments.endsAt), gt(assignments.endsAt, now)),
        scope.kind === "plan"
          ? inArray(assignments.planId, scope.planIds)
          : undefined,
      ),
    );
  return new Set(rows.map((row) => row.tenantId));
}

/** One firing a scan detected, before its firing quota check. */
type Detection = {
  /** The tenant's billing cycle: only used to find which firing quota
   * window the firing counts toward (for billing_cycle_end windows). */
  billingCycle: BillingCycle;
  occurredAt: number;
  payload: FiringPayload;
  tenantId: string;
  /** The rule_runs trigger_key the firing is recorded under. */
  triggerKey: string;
};

/**
 * Fire one page of detections. Different tenants are checked in parallel,
 * but one tenant's detections are checked one at a time, oldest first: when
 * the rule's firing quota can't fit all of them, the oldest event gets the
 * firing, the same one the backfill job would pick.
 */
async function fireDetections({
  detections,
  rule,
}: {
  detections: Detection[];
  rule: Rule;
}): Promise<void> {
  const detectionsByTenant = new Map<string, Detection[]>();
  for (const detection of detections) {
    const tenantDetections = detectionsByTenant.get(detection.tenantId) ?? [];
    tenantDetections.push(detection);
    detectionsByTenant.set(detection.tenantId, tenantDetections);
  }
  const tenantGroups = [...detectionsByTenant.values()];
  const passed: { billingCycle: BillingCycle; firing: Firing }[] = [];
  for (
    let start = 0;
    start < tenantGroups.length;
    start += FIRING_QUOTA_CHECK_CONCURRENCY
  ) {
    const groupPassed = await Promise.all(
      tenantGroups
        .slice(start, start + FIRING_QUOTA_CHECK_CONCURRENCY)
        .map(async (tenantDetections) => {
          const tenantPassed: {
            billingCycle: BillingCycle;
            firing: Firing;
          }[] = [];
          for (const detection of tenantDetections) {
            const tokenTaken = await takeFiringQuotaToken({
              billingCycle: detection.billingCycle,
              rule,
              tenantId: detection.tenantId,
            });
            if (!tokenTaken) {
              continue;
            }
            tenantPassed.push({
              billingCycle: detection.billingCycle,
              firing: {
                rule,
                tenantId: detection.tenantId,
                triggerKey: detection.triggerKey,
                occurredAt: detection.occurredAt,
                payload: detection.payload,
              },
            });
          }
          return tenantPassed;
        }),
    );
    passed.push(...groupPassed.flat());
  }
  let alreadyRecorded: Firing[];
  try {
    alreadyRecorded = await recordFirings({
      firings: passed.map(({ firing }) => firing),
    });
  } catch (error) {
    /* The quota checks spent tokens on firings that never landed. The
     * bookmark doesn't move, so the page is retried; drop those counters so
     * the retry re-counts from rule_runs instead of treating the lost
     * firings as already fired. If dropping them fails too, the counters
     * still say those firings happened, so the retry can skip them for good;
     * log that, but still throw the insert's error, since that's what failed
     * the page. */
    await Promise.all(
      passed.map(({ billingCycle, firing }) =>
        forgetFiringQuota({ billingCycle, rule, tenantId: firing.tenantId }),
      ),
    ).catch((forgetError) =>
      console.error("firing quota give-back failed", {
        count: passed.length,
        error: forgetError,
        ruleId: rule.ruleId,
      }),
    );
    throw error;
  }
  /* A page read a second time (after a crash before saveBookmark, or by two
   * passes at once) finds its firings already recorded. */
  if (alreadyRecorded.length === 0) {
    return;
  }
  console.log("rule page re-read: firings already recorded", {
    count: alreadyRecorded.length,
    ruleId: rule.ruleId,
  });
  const alreadyRecordedFirings = new Set(alreadyRecorded);
  /* No catch here, unlike the give-back in the catch above: every firing
   * on this page is already in rule_runs, so a failure can't lose a firing
   * or run one twice. The throw just means runRulePass logs the error and
   * the next tick re-reads this page (walkPages skips saveBookmark). The
   * worst case is a firing quota counter left too high, which can skip
   * that tenant's next firing in the same firing quota window until the
   * counter expires. */
  await Promise.all(
    passed
      .filter(({ firing }) => alreadyRecordedFirings.has(firing))
      .map(({ billingCycle, firing }) =>
        forgetFiringQuota({ billingCycle, rule, tenantId: firing.tenantId }),
      ),
  );
}

/**
 * An inactive_for firing's trigger key: one per quiet spell, named by the
 * tenant's last activity (microseconds) when the spell began. Shared with the
 * backfill job, so a spell is keyed the same whichever path records it.
 */
export function inactiveTriggerKey({
  lastAtMicroseconds,
}: {
  lastAtMicroseconds: number;
}): string {
  return `inactive_for:${lastAtMicroseconds}`;
}

/**
 * Fire an inactive_for rule for tenants with no event on its meter for the
 * rule's window: tenant_last_activity rows past the bookmark whose last
 * activity is at or before the cutoff, quietest first. The trigger key is
 * the last-activity timestamp (inactiveTriggerKey), so each quiet spell fires
 * once, and a new event moves the tenant's row forward into a new spell. A
 * billing_cycle_end window only changes which firings count toward the
 * quota.
 */
async function scanInactive({
  bookmark,
  rule,
}: {
  bookmark: Bookmark;
  rule: Rule;
}): Promise<void> {
  const trigger = rule.trigger;
  if (trigger.type !== "inactive_for") {
    return;
  }
  const { meterId } = trigger;
  const windowMs = durationToMs(trigger.duration);
  const cutoffMicroseconds = (Date.now() - windowMs) * MICROSECONDS_PER_MS;
  const scope = rule.scope;
  /* A billing_cycle_end window counts firings per billing period, so it
   * needs each tenant's billing cycle on the meter's product lines
   * (createRule requires those product lines to be synchronized, so any one
   * of them anchors). Other windows never read the billing cycle. */
  let productLineIds: string[] = [];
  if (rule.recurrence.window === "billing_cycle_end") {
    const [meterRow] = await db
      .select()
      .from(meters)
      .where(eq(meters.meterId, meterId))
      .limit(1);
    productLineIds = meterRow?.productLineIds ?? [];
  }
  await walkPages({
    bookmark,
    handlePage: async ({ rows }) => {
      /* pg trails ingest by up to a checkpoint, and the mlast: key holds
       * any newer event, so judge each tenant by the later of the two. When
       * Redis is newer, bump the row to it: the row moves past the bookmark
       * and comes back around exactly when that activity goes stale,
       * whether or not the checkpoint has caught up. */
      const redisMicroseconds = await redis.mget(
        ...rows.map((row) =>
          keys.lastActivity({ meterId, tenantId: row.tenantId }),
        ),
      );
      const quiet: { lastAtMicroseconds: number; tenantId: string }[] = [];
      for (const [i, row] of rows.entries()) {
        const lastAtMicroseconds = Math.max(
          row.lastEventAtMicroseconds,
          Number(redisMicroseconds[i] ?? 0),
        );
        if (lastAtMicroseconds <= cutoffMicroseconds) {
          quiet.push({ lastAtMicroseconds, tenantId: row.tenantId });
          continue;
        }
        /*
         * One update at a time is fine here. A page only holds tenants
         * whose quiet time just reached the rule's duration, however big
         * the table is, and an update only runs for those Redis has seen
         * come back since pg's copy. The checkpoint copies Redis into pg
         * every CHECKPOINT_INTERVAL_MS, so that's only a tenant who came
         * back within the last CHECKPOINT_INTERVAL_MS: normally none.
         *
         * The only slow case is the checkpoint failing for longer than the
         * rule's duration, which logs "meter balance checkpoint failed"
         * every CHECKPOINT_INTERVAL_MS the whole time. Then every tenant
         * active on the meter since it stopped comes through here once, up
         * to SCAN_PAGE_SIZE x SCAN_MAX_PAGES_PER_TICK updates per tick. At
         * ~0.5ms each (measured locally; a network hop to pg adds to that),
         * a tick takes ~5s, and every other scheduled rule waits too, since
         * each group of RULE_PASS_CONCURRENCY passes waits for its slowest.
         *
         * That's a one-time catch-up, not a steady cost: each update moves
         * the tenant's row to its real last activity, so ticks are back to
         * normal once they're all through (100,000 tenants: ~10 ticks,
         * under a minute), with no one stepping in. It only happens again
         * if the checkpoint is still down a full rule's duration later.
         */
        await db
          .update(tenantLastActivity)
          .set({ lastEventAtMicroseconds: lastAtMicroseconds })
          .where(
            and(
              eq(tenantLastActivity.tenantId, row.tenantId),
              eq(tenantLastActivity.meterId, meterId),
              lt(
                tenantLastActivity.lastEventAtMicroseconds,
                lastAtMicroseconds,
              ),
            ),
          );
      }
      const inScope = await tenantsInScope({
        rule,
        tenantIds: quiet.map((tenant) => tenant.tenantId),
      });
      const due = quiet.filter((tenant) => inScope.has(tenant.tenantId));
      const billingCyclesByTenant = await getBillingCycles({
        productLineIds,
        tenantIds: due.map((tenant) => tenant.tenantId),
      });
      const occurredAt = Date.now();
      await fireDetections({
        detections: due.map((tenant) => ({
          billingCycle: billingCyclesByTenant.get(tenant.tenantId) ?? null,
          occurredAt,
          payload: {
            type: "inactive_for",
            meterId,
            occurredAt,
            backfilled: false,
          },
          tenantId: tenant.tenantId,
          triggerKey: inactiveTriggerKey({
            lastAtMicroseconds: tenant.lastAtMicroseconds,
          }),
        })),
        rule,
      });
    },
    positionOf: ({ row }) => ({
      cursorAtMicroseconds: row.lastEventAtMicroseconds,
      cursorId: row.tenantId,
    }),
    readPage: ({ after }: { after: Bookmark }) =>
      db
        .select({
          lastEventAtMicroseconds: tenantLastActivity.lastEventAtMicroseconds,
          tenantId: tenantLastActivity.tenantId,
        })
        .from(tenantLastActivity)
        .where(
          and(
            eq(tenantLastActivity.meterId, meterId),
            /* tenantsInScope would drop the other tenants anyway. Filtering
             * here keeps a tenant-scoped rule from reading every tenant on
             * the meter just to keep one. (tenant_id, meter_id) is
             * tenant_last_activity's primary key, so Postgres reads only
             * this tenant's row: the kind of SQL filter walkPages allows. */
            scope.kind === "tenant"
              ? eq(tenantLastActivity.tenantId, scope.tenantId)
              : undefined,
            pastBookmarkMicroseconds({
              after,
              atMicroseconds: tenantLastActivity.lastEventAtMicroseconds,
              id: tenantLastActivity.tenantId,
            }),
            lte(tenantLastActivity.lastEventAtMicroseconds, cutoffMicroseconds),
          ),
        )
        .orderBy(
          asc(tenantLastActivity.lastEventAtMicroseconds),
          asc(tenantLastActivity.tenantId),
        )
        .limit(SCAN_PAGE_SIZE),
    ruleId: rule.ruleId,
  });
}

/**
 * A lifecycle event instance surfaced by a scheduler scan, normalized off
 * its source row so the page loop below is source-agnostic.
 */
export type LifecycleEvent = {
  /** When the event happened; the rule's offset is applied to this. */
  eventAtMs: number;
  /** Unique per event instance: orders same-time events for the bookmark,
   * and identifies the firing. */
  eventId: string;
  tenantId: string;
  /** The event row's plan (assignments); null when the row has none. */
  planId: string | null;
  /** Payload fact: the invoice the event is on (invoice events only). */
  invoiceId: string | null;
  /** Payload fact: the assignment the event is on (assignment events only). */
  assignmentId: string | null;
};

/**
 * An invoice or assignment event's trigger key. Shared with the backfill
 * job, so an event is keyed the same whichever path records it.
 */
export function lifecycleEventTriggerKey({
  event,
  relativeTo,
}: {
  event: LifecycleEvent;
  relativeTo: string;
}): string {
  return `${relativeTo}:${event.eventId}`;
}

/** A billing period's cycle_end trigger key. Shared with the backfill job,
 * like lifecycleEventTriggerKey. */
export function cycleEndTriggerKey({
  assignmentId,
  periodStart,
}: {
  assignmentId: string;
  periodStart: number;
}): string {
  return `cycle_end:${assignmentId}:${periodStart}`;
}

/** Which rows a lifecycle scan reads: past the bookmark, at or before the
 * threshold. */
type LifecycleScanRange = { after: Bookmark; thresholdMs: number };

/** Reads one page of lifecycle events in the scan range. */
type LifecycleEventReader = (
  range: LifecycleScanRange,
) => Promise<LifecycleEvent[]>;

/** One page of invoice_finalized events: invoices by when they were
 * finalized. */
async function readInvoiceFinalizedEvents({
  after,
  thresholdMs,
}: LifecycleScanRange): Promise<LifecycleEvent[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        isNotNull(invoices.finalizedAt),
        pastBookmarkMs({
          after,
          atMs: invoices.finalizedAt,
          id: invoices.invoiceId,
        }),
        lte(invoices.finalizedAt, thresholdMs),
      ),
    )
    .orderBy(asc(invoices.finalizedAt), asc(invoices.invoiceId))
    .limit(SCAN_PAGE_SIZE);
  const events: LifecycleEvent[] = [];
  for (const invoice of rows) {
    if (invoice.finalizedAt === null) {
      continue;
    }
    events.push({
      eventAtMs: invoice.finalizedAt,
      eventId: invoice.invoiceId,
      tenantId: invoice.tenantId,
      planId: null,
      invoiceId: invoice.invoiceId,
      assignmentId: null,
    });
  }
  return events;
}

/** One page of invoice_due events: invoices by when payment is due. */
async function readInvoiceDueEvents({
  after,
  thresholdMs,
}: LifecycleScanRange): Promise<LifecycleEvent[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        isNotNull(invoices.dueAt),
        pastBookmarkMs({
          after,
          atMs: invoices.dueAt,
          id: invoices.invoiceId,
        }),
        lte(invoices.dueAt, thresholdMs),
      ),
    )
    .orderBy(asc(invoices.dueAt), asc(invoices.invoiceId))
    .limit(SCAN_PAGE_SIZE);
  const events: LifecycleEvent[] = [];
  for (const invoice of rows) {
    if (invoice.dueAt === null) {
      continue;
    }
    events.push({
      eventAtMs: invoice.dueAt,
      eventId: invoice.invoiceId,
      tenantId: invoice.tenantId,
      planId: null,
      invoiceId: invoice.invoiceId,
      assignmentId: null,
    });
  }
  return events;
}

/** One page of assignment_started events: assignments by when they
 * start. */
async function readAssignmentStartedEvents({
  after,
  thresholdMs,
}: LifecycleScanRange): Promise<LifecycleEvent[]> {
  const rows = await db
    .select()
    .from(assignments)
    .where(
      and(
        pastBookmarkMs({
          after,
          atMs: assignments.startsAt,
          id: assignments.assignmentId,
        }),
        lte(assignments.startsAt, thresholdMs),
      ),
    )
    .orderBy(asc(assignments.startsAt), asc(assignments.assignmentId))
    .limit(SCAN_PAGE_SIZE);
  return rows.map((assignment) => ({
    eventAtMs: assignment.startsAt,
    eventId: assignment.assignmentId,
    tenantId: assignment.tenantId,
    planId: assignment.planId,
    invoiceId: null,
    assignmentId: assignment.assignmentId,
  }));
}

/** Fire an invoice_finalized / invoice_due / assignment_started rule for
 * events whose time + offset has passed. */
async function scanLifecycleEvents({
  bookmark,
  rule,
}: {
  bookmark: Bookmark;
  rule: Rule;
}): Promise<void> {
  const trigger = rule.trigger;
  if (trigger.type !== "relative_to_lifecycle_event") {
    return;
  }
  const { relativeTo } = trigger;
  const thresholdMs = Date.now() - durationToMs(trigger.offset);
  /* The event source and scope filter per lifecycle event.
   * invoice_finalized / invoice_due read invoices (by finalized_at or
   * due_at): the rows carry no plan, so the scope check is an open
   * assignment in scope, one query per page (global rules skip it).
   * assignment_started reads assignments: the row carries its tenant and
   * plan, so it matches the scope directly. cycle_end is scanned by
   * scanCycleEnds from billing_periods receipts. */
  let readEvents: LifecycleEventReader;
  let scopeEvents: ({
    events,
  }: {
    events: LifecycleEvent[];
  }) => Promise<LifecycleEvent[]>;
  if (relativeTo === "invoice_finalized" || relativeTo === "invoice_due") {
    readEvents =
      relativeTo === "invoice_finalized"
        ? readInvoiceFinalizedEvents
        : readInvoiceDueEvents;
    scopeEvents = async ({ events }) => {
      if (rule.scope.kind === "global") {
        return events;
      }
      const inScope = await tenantsInScope({
        rule,
        tenantIds: events.map((event) => event.tenantId),
      });
      return events.filter((event) => inScope.has(event.tenantId));
    };
  } else if (relativeTo === "assignment_started") {
    readEvents = readAssignmentStartedEvents;
    const scope = rule.scope;
    scopeEvents = async ({ events }) =>
      events.filter((event) => {
        if (scope.kind === "global") {
          return true;
        }
        if (scope.kind === "tenant") {
          return event.tenantId === scope.tenantId;
        }
        return event.planId !== null && scope.planIds.includes(event.planId);
      });
  } else if (relativeTo === "cycle_end") {
    return;
  } else {
    /* A lifecycle event added to the schema without a scan here: the
     * never assignment trips typecheck, and this throws if it's ignored. */
    const exhaustive: never = relativeTo;
    throw new Error(`unknown lifecycle event: ${JSON.stringify(exhaustive)}`);
  }
  /* A billing_cycle_end window counts firings per billing period, so it
   * needs each candidate's current billing period boundary ("anchor").
   * Billing period boundaries exist only per product line -- a tenant
   * holds at most one open assignment per product line -- and two upstream
   * checks pin this rule to one product line: createRule only allows a
   * billing_cycle_end window on a lifecycle rule with a plan scope whose
   * plans share one product line, and the scope filter surfaced only
   * tenants with an open assignment on those plans (invoices) or
   * assignments on those plans (assignment_started). So every in-scope
   * event has an open assignment in the anchor product line, and this one
   * lookup covers them all. A tenant or global scope can't pin a product
   * line (a tenant can be on several, each with its own billing cycle), so
   * createRule rejects them and they get no anchor here. Rules with
   * rolling/permanent windows never read the billing cycle. */
  let anchorProductLineId: string | null = null;
  if (rule.scope.kind === "plan") {
    const planRows = await db
      .select()
      .from(plans)
      .where(inArray(plans.planId, rule.scope.planIds));
    const lines = new Set(planRows.map((plan) => plan.productLineId));
    anchorProductLineId = lines.size === 1 ? [...lines][0] : null;
  }
  await walkPages({
    bookmark,
    handlePage: async ({ rows }) => {
      /* Scope is checked here, not in the query: see walkPages. */
      const scoped = await scopeEvents({ events: rows });
      const billingCyclesByTenant =
        anchorProductLineId === null
          ? new Map<string, NonNullable<BillingCycle>>()
          : await getBillingCycles({
              productLineIds: [anchorProductLineId],
              tenantIds: scoped.map((event) => event.tenantId),
            });
      const occurredAt = Date.now();
      await fireDetections({
        detections: scoped.map((event) => ({
          billingCycle: billingCyclesByTenant.get(event.tenantId) ?? null,
          occurredAt,
          payload: {
            type: "relative_to_lifecycle_event",
            invoiceId: event.invoiceId,
            assignmentId: event.assignmentId,
            occurredAt,
            backfilled: false,
          },
          tenantId: event.tenantId,
          triggerKey: lifecycleEventTriggerKey({ event, relativeTo }),
        })),
        rule,
      });
    },
    positionOf: ({ row }) => ({
      cursorAtMicroseconds: row.eventAtMs * MICROSECONDS_PER_MS,
      cursorId: row.eventId,
    }),
    readPage: ({ after }: { after: Bookmark }) =>
      readEvents({ after, thresholdMs }),
    ruleId: rule.ruleId,
  });
}

/**
 * Fire a cycle_end rule for billing periods whose end + offset has passed.
 *
 * Never reads past frontierMs: the end of the oldest billing period that
 * has ended but whose next billing period advanceBillingPeriods hasn't
 * written yet. Reading further could move the bookmark past that next
 * billing period's end before its row exists, and the scan never looks
 * behind its bookmark, so it would never fire. Stopping at frontierMs
 * makes later firings wait instead.
 */
async function scanCycleEnds({
  bookmark,
  frontierMs,
  rule,
}: {
  bookmark: Bookmark;
  frontierMs: number | null;
  rule: Rule;
}): Promise<void> {
  const trigger = rule.trigger;
  if (trigger.type !== "relative_to_lifecycle_event") {
    return;
  }
  const dueEndMs = Date.now() - durationToMs(trigger.offset);
  const throughMs =
    frontierMs === null ? dueEndMs : Math.min(dueEndMs, frontierMs);
  const scope = rule.scope;
  await walkPages({
    bookmark,
    handlePage: ({ rows }) => {
      const occurredAt = Date.now();
      return fireDetections({
        detections: rows
          .filter((billingPeriod) => {
            /* Fire for every billing period the tenant was on for any
             * amount of time, at its scheduled end plus the rule's offset,
             * even if the assignment ends partway through it. An assignment
             * covers [startsAt, endsAt) and a billing period covers
             * [periodStart, periodEnd): each includes its start and excludes
             * its end. A billing period never starts before its assignment
             * does, so the tenant was never on it only when endsAt <=
             * periodStart. That happens when a future-dated assignment is
             * cancelled before it starts, since its first billing period is
             * written when the assignment is created. */
            if (
              billingPeriod.assignmentEndsAt !== null &&
              billingPeriod.assignmentEndsAt <= billingPeriod.periodStart
            ) {
              return false;
            }
            if (scope.kind === "global") {
              return true;
            }
            if (scope.kind === "tenant") {
              return billingPeriod.tenantId === scope.tenantId;
            }
            return scope.planIds.includes(billingPeriod.planId);
          })
          .map((billingPeriod) => ({
            /* This billing period's start and length stand in for the tenant's
             * billing cycle: billing periods start on the billing cycle's
             * boundaries, so billing_cycle_end firing quota windows line up the
             * same way, with no lookup. */
            billingCycle: {
              anchorMs: billingPeriod.periodStart,
              windowMs: billingPeriod.windowMs,
            },
            occurredAt,
            payload: {
              type: "relative_to_lifecycle_event",
              invoiceId: null,
              assignmentId: billingPeriod.assignmentId,
              occurredAt,
              backfilled: false,
            },
            tenantId: billingPeriod.tenantId,
            triggerKey: cycleEndTriggerKey({
              assignmentId: billingPeriod.assignmentId,
              periodStart: billingPeriod.periodStart,
            }),
          })),
        rule,
      });
    },
    positionOf: ({ row }) => ({
      cursorAtMicroseconds: row.periodEnd * MICROSECONDS_PER_MS,
      cursorId: row.assignmentId,
    }),
    /* Scope is checked in handlePage, not this query: see walkPages. */
    readPage: ({ after }: { after: Bookmark }) =>
      db
        .select({
          assignmentEndsAt: assignments.endsAt,
          assignmentId: billingPeriods.assignmentId,
          periodEnd: billingPeriods.periodEnd,
          periodStart: billingPeriods.periodStart,
          planId: assignments.planId,
          tenantId: billingPeriods.tenantId,
          windowMs: billingPeriods.windowMs,
        })
        .from(billingPeriods)
        /* The join brings in the assignment's plan and end date, which
         * billing_periods doesn't store. It stays cheap at any table size:
         * each billing period has exactly one assignment, looked up by the
         * assignments primary key, so it adds one index lookup per row,
         * at most SCAN_PAGE_SIZE per page. Measured with 100,000
         * assignments and billing periods: Postgres reads billing_periods
         * in billing_periods_end order and looks up each assignment by
         * primary key, ~3ms for a full page. */
        .innerJoin(
          assignments,
          eq(assignments.assignmentId, billingPeriods.assignmentId),
        )
        .where(
          and(
            pastBookmarkMs({
              after,
              atMs: billingPeriods.periodEnd,
              id: billingPeriods.assignmentId,
            }),
            lte(billingPeriods.periodEnd, throughMs),
          ),
        )
        .orderBy(
          asc(billingPeriods.periodEnd),
          asc(billingPeriods.assignmentId),
        )
        .limit(SCAN_PAGE_SIZE),
    ruleId: rule.ruleId,
  });
}

/**
 * When a tenant's current billing period ends, write the row for their
 * next one. Every billing period gets a row when it starts (the first
 * when the assignment is created; see insertFirstPeriodReceipt), which is
 * what lets cycle_end rules find billing period ends by index. Runs at
 * the start of every scheduler tick.
 *
 * Each page is one transaction, in three steps:
 *   1. Lock up to ENDED_BILLING_PERIOD_PAGE_SIZE current billing periods
 *      that have ended, oldest first, and read each one's assignment end
 *      date. Other processes skip locked rows, so each row is advanced by
 *      exactly one process.
 *   2. Mark them no longer current.
 *   3. For each whose assignment is still open, write the next billing
 *      period (starting where this one ended) and mark it current.
 *
 * Edge cases:
 *   - Falling behind: the next billing period may already be over too.
 *     It's current and ended, so a later page advances it again, until
 *     the tenant reaches the billing period happening now.
 *   - Ending assignments: an assignment covers [startsAt, endsAt), so
 *     step 3 skips the next billing period when endsAt is at or before
 *     the time it would start. If the assignment ends partway through it
 *     instead (a fixed term), the full billing period is still written,
 *     and cycle_end rules fire on its scheduled end like any other. Once
 *     the assignment's last billing period ends, step 3 writes nothing
 *     after it.
 *   - End dates that change while a page runs: step 1 doesn't lock
 *     assignments, so an end date can move earlier after step 1 reads it
 *     (e.g. a plan change backdated to before the next billing period
 *     starts). Step 3 then writes a billing period the assignment never
 *     gets to. That's harmless: scanCycleEnds doesn't fire for a billing
 *     period that starts at or after its assignment ends, and when it
 *     ends, step 3 writes nothing after it.
 *   - Plan changes backdated to an old billing period's start: the new
 *     assignment's billing periods can start exactly where the old
 *     assignment's rows do. Step 3's insert overwrites a row with the
 *     same tenant, product line, and start (onConflictDoUpdate), so the
 *     new assignment's billing period replaces the old one's, as
 *     insertFirstPeriodReceipt does.
 */
async function advanceBillingPeriods(): Promise<void> {
  /* Almost every tick has nothing to advance, so check with one plain
   * query first: 1 round trip (~0.16ms measured locally), where opening
   * the transaction below and finding nothing takes 3 (~0.39ms). */
  const [anyEnded] = await db
    .select({ periodEnd: billingPeriods.periodEnd })
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.isCurrent, true),
        lte(billingPeriods.periodEnd, Date.now()),
      ),
    )
    .limit(1);
  if (anyEnded === undefined) {
    return;
  }
  for (let page = 0; page < ENDED_BILLING_PERIOD_MAX_PAGES_PER_TICK; page++) {
    const advanced = await db.transaction(async (tx) => {
      const ended = await tx
        .select({
          assignmentEndsAt: assignments.endsAt,
          assignmentId: billingPeriods.assignmentId,
          periodEnd: billingPeriods.periodEnd,
          periodStart: billingPeriods.periodStart,
          productLineId: billingPeriods.productLineId,
          tenantId: billingPeriods.tenantId,
          windowMs: billingPeriods.windowMs,
        })
        .from(billingPeriods)
        /* Each billing period has exactly one assignment, looked up by
         * the assignments primary key: at most
         * ENDED_BILLING_PERIOD_PAGE_SIZE lookups per page. */
        .innerJoin(
          assignments,
          eq(assignments.assignmentId, billingPeriods.assignmentId),
        )
        .where(
          and(
            eq(billingPeriods.isCurrent, true),
            lte(billingPeriods.periodEnd, Date.now()),
          ),
        )
        .orderBy(asc(billingPeriods.periodEnd))
        .limit(ENDED_BILLING_PERIOD_PAGE_SIZE)
        .for("update", { of: billingPeriods, skipLocked: true });
      if (ended.length === 0) {
        return 0;
      }
      /* The keys go in as three arrays, not one (tenant, product line,
       * start) list: Postgres takes ~140ms just to plan a 1,000-entry
       * list of three-part keys, and ~8ms to run this whole update
       * (measured with 1,000 rows). */
      await tx.execute(sql`
        update ${billingPeriods} as bp set is_current = false
        from unnest(
          ${sql.param(ended.map((row) => row.tenantId))}::text[],
          ${sql.param(ended.map((row) => row.productLineId))}::text[],
          ${sql.param(ended.map((row) => row.periodStart))}::bigint[]
        ) as ended(tenant_id, product_line_id, period_start)
        where bp.tenant_id = ended.tenant_id
          and bp.product_line_id = ended.product_line_id
          and bp.period_start = ended.period_start
      `);
      const nextBillingPeriods = ended.flatMap((row) => {
        // The next billing period would start where this one ended.
        if (
          row.assignmentEndsAt !== null &&
          row.assignmentEndsAt <= row.periodEnd
        ) {
          return [];
        }
        if (row.windowMs <= 0) {
          console.error("billing period has no length, so it can't advance", {
            assignmentId: row.assignmentId,
            tenantId: row.tenantId,
          });
          return [];
        }
        return [
          {
            tenantId: row.tenantId,
            productLineId: row.productLineId,
            assignmentId: row.assignmentId,
            periodStart: row.periodEnd,
            periodEnd: row.periodEnd + row.windowMs,
            windowMs: row.windowMs,
            isCurrent: true,
          },
        ];
      });
      if (nextBillingPeriods.length > 0) {
        await tx
          .insert(billingPeriods)
          .values(nextBillingPeriods)
          .onConflictDoUpdate({
            target: [
              billingPeriods.tenantId,
              billingPeriods.productLineId,
              billingPeriods.periodStart,
            ],
            set: {
              assignmentId: sql`excluded.assignment_id`,
              periodEnd: sql`excluded.period_end`,
              windowMs: sql`excluded.window_ms`,
              isCurrent: sql`excluded.is_current`,
            },
          });
      }
      return ended.length;
    });
    if (advanced < ENDED_BILLING_PERIOD_PAGE_SIZE) {
      return;
    }
  }
}

/**
 * The end of the oldest billing period that has ended but whose next
 * billing period advanceBillingPeriods hasn't written yet, or null when
 * advanceBillingPeriods is caught up. scanCycleEnds doesn't read past this
 * point, so cycle_end firings for billing periods ending later fire late
 * instead of never: on the tick advanceBillingPeriods catches up, which is
 * normally the same tick (it runs first). They only stay delayed while
 * advanceBillingPeriods is working through a backlog, or failing (which it
 * logs every tick).
 */
export async function unadvancedFrontierMs(): Promise<number | null> {
  const [row] = await db
    .select({ periodEnd: billingPeriods.periodEnd })
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.isCurrent, true),
        lte(billingPeriods.periodEnd, Date.now()),
      ),
    )
    .orderBy(asc(billingPeriods.periodEnd))
    .limit(1);
  return row?.periodEnd ?? null;
}

/** Live rules the scheduler evaluates. */
async function getScheduledRules(): Promise<Rule[]> {
  return db
    .select()
    .from(rules)
    .where(
      and(
        isNull(rules.deprecatedAt),
        inArray(sql`${rules.trigger} ->> 'type'`, SCHEDULED_TRIGGER_TYPES),
      ),
    );
}

/** One rule's pass. Errors are logged per rule, so one bad rule can't stall
 * the rest. */
async function runRulePass({
  claimed,
  frontierMs,
}: {
  claimed: ClaimedRule;
  frontierMs: number | null;
}): Promise<void> {
  const { bookmark, rule } = claimed;
  const trigger = rule.trigger;
  try {
    switch (trigger.type) {
      case "inactive_for":
        await scanInactive({ bookmark, rule });
        break;
      case "relative_to_lifecycle_event":
        if (trigger.relativeTo === "cycle_end") {
          await scanCycleEnds({ bookmark, frontierMs, rule });
        } else {
          await scanLifecycleEvents({ bookmark, rule });
        }
        break;
      case "microcredits_remaining":
      case "microcredits_spent":
        // Evaluated at meter-event time; getScheduledRules never returns these.
        break;
      default: {
        const exhaustive: never = trigger;
        throw new Error(`unknown rule trigger: ${JSON.stringify(exhaustive)}`);
      }
    }
  } catch (error) {
    console.error("rule pass failed", { error, ruleId: rule.ruleId });
  }
}

/**
 * One scheduler tick: advance ended billing periods, then claim live rules
 * in batches and run their passes, RULE_PASS_CONCURRENCY at a time. A rule
 * another process holds is skipped: that process is running it.
 */
export async function evaluateScheduledRules(): Promise<void> {
  /* A failure here only holds back cycle_end rules, which never read past a
   * billing period that hasn't been closed (see unadvancedFrontierMs), so
   * the rest of the tick still runs. */
  try {
    await advanceBillingPeriods();
  } catch (error) {
    console.error("billing period advance failed", error);
  }
  const scheduledRules = await getScheduledRules();
  if (scheduledRules.length === 0) {
    return;
  }
  if (scheduledRules.length > MAX_SCHEDULED_RULES) {
    console.error("scheduled rules exceed per-tick capacity", {
      count: scheduledRules.length,
      max: MAX_SCHEDULED_RULES,
    });
  }
  const frontierMs = await unadvancedFrontierMs();
  for (let batch = 0; batch < RULE_CLAIM_MAX_BATCHES_PER_TICK; batch++) {
    const offered = scheduledRules.slice(
      batch * RULE_CLAIM_BATCH,
      (batch + 1) * RULE_CLAIM_BATCH,
    );
    if (offered.length === 0) {
      return;
    }
    const { claimed, claimedAtMs } = await claimRules({
      scheduledRules: offered,
    });
    if (claimed.length === 0) {
      continue;
    }
    for (
      let start = 0;
      start < claimed.length;
      start += RULE_PASS_CONCURRENCY
    ) {
      await Promise.all(
        claimed
          .slice(start, start + RULE_PASS_CONCURRENCY)
          .map((claimedRule) =>
            runRulePass({ claimed: claimedRule, frontierMs }),
          ),
      );
    }
    /* One release for the whole claim batch rather than one per rule: that
     * saves a round trip per rule. A rule whose pass finished early stays
     * claimed until the rest of its batch is done, so another process skips
     * it a little longer; this process runs it again next tick either way.
     *
     * One bad rule can't hold this release forever: runRulePass catches
     * and logs every error, and no Postgres statement can run past
     * STATEMENT_TIMEOUT_MS (db/index.ts). */
    try {
      await releaseRules({
        claimedAtMs,
        ruleIds: claimed.map((claimedRule) => claimedRule.rule.ruleId),
      });
    } catch (error) {
      console.error("rule claim release failed", {
        error,
        ruleIds: claimed.map((claimedRule) => claimedRule.rule.ruleId),
      });
    }
  }
}

let schedulerTickRunning = false;

/**
 * Start the scheduler loop. The guard skips a beat when a tick overruns --
 * ticks self-pace and never overlap. Errors are logged, never thrown.
 */
export function startRuleSchedulerLoop(): void {
  const loop = setInterval(() => {
    if (schedulerTickRunning) {
      return;
    }
    schedulerTickRunning = true;
    evaluateScheduledRules()
      .catch((error) => console.error("rule scheduler tick failed", error))
      .finally(() => {
        schedulerTickRunning = false;
      });
  }, SCHEDULER_INTERVAL_MS);
  loop.unref();
}
