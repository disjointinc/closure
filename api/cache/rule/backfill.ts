/**
 * cache/rule/backfill.ts -- applies a rule to the time before it existed,
 * for rules created with backfill "once_per_tenant" or "every_firing" (see
 * ruleBackfillSchema in schemas/rule.ts).
 *
 * The live engine fires a rule only for conditions met after the rule was
 * created. This job covers exactly what the live engine skips, with the
 * rule's createdAt as the line between them:
 *
 *   - relative_to_lifecycle_event: events whose fire time (event time +
 *     offset) came before the rule existed -- the rows the scheduler's
 *     starting bookmark skips (startingCursorAtMicroseconds in schedule.ts).
 *   - inactive_for: quiet spells whose window finished before the rule
 *     existed, the complement of that same bookmark.
 *   - microcredits_remaining / microcredits_spent: meter events received
 *     before the rule existed.
 *
 * Each tenant's history is replayed as if the rule had existed: scope,
 * percentage thresholds, the billing cycle, and recurrence limits are all
 * judged as of the moment each past firing would have happened. SQL
 * narrows a batch's history down to candidate firings, so raw events never
 * stream into the process; the live engine's own functions (edge
 * detectors, trigger keys, recurrence windows) make the final call, so a
 * backfilled firing is keyed and limited exactly as a live one would have
 * been.
 *
 * Tenants are walked in tenant_id order, BACKFILL_TENANT_BATCH at a time.
 * A batch's firings, the cursor, and the pacing deadline commit in one
 * transaction. A crash re-runs at most that batch, and the replay is
 * deterministic (same firings, same keys), so the rule_runs idempotency
 * index absorbs the re-run.
 *
 * Firings are paced: their rule_runs come due (available_at)
 * BACKFILL_FIRING_SPACING_MS apart, tracked in
 * rule_backfills.next_available_at, so a backfill drains at a fixed rate
 * behind live firings (which are due at once), and the integrations its
 * tasks notify aren't flooded.
 *
 * Not replayed: events that never reached meter_events (the DLQ).
 *
 * Every API process runs this loop. A process claims a backfill by setting
 * rule_backfills.claimed_at, and others skip it until that's
 * BACKFILL_CLAIM_LEASE_MS old, so processes split the backfills, one at a
 * time each.
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
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  assignments,
  billingPeriods,
  invoices,
  meterBalances,
  meterEvents,
  meterOverrides,
  meters,
  planMeters,
  plans,
  ruleBackfills,
  rules,
  tenantLastActivity,
  tenants,
} from "../../db/schema.ts";
import type { FiringPayload, Rule } from "../../schemas/rule.ts";
import { redis } from "../index.ts";
import { keys } from "../keys.ts";
import {
  parsePendingEntry,
  PG_FOREIGN_KEY_VIOLATION,
  pgErrorCode,
} from "../meter/index.ts";
import {
  type BillingCycle,
  crossedRemainingThreshold,
  crossedSpendThreshold,
  durationToMs,
  type Firing,
  firingLimit,
  firingRuleRuns,
  insertRuleRuns,
  meterEventTriggerKey,
  ruleAppliesToTenant,
  windowStartMs,
} from "./evaluate.ts";
import {
  cycleEndTriggerKey,
  inactiveTriggerKey,
  type LifecycleEvent,
  lifecycleEventTriggerKey,
  MICROSECONDS_PER_MS,
  unadvancedFrontierMs,
} from "./schedule.ts";

/** How often each process looks for backfill work. Backfills aren't
 * latency-sensitive: their firings are paced out anyway. */
const BACKFILL_INTERVAL_MS = 1_000;
/*
 * Tenants replayed per batch (one history read and one transaction), and
 * batches per tick: a bigger backfill carries over to later ticks (the
 * cursor keeps its place).
 *
 * Why these values: BACKFILL_TENANT_BATCH keeps each transaction short, so
 * a backfill never holds locks that live writes wait on.
 * BACKFILL_MAX_BATCHES_PER_TICK keeps a pass far under
 * BACKFILL_CLAIM_LEASE_MS. Speed isn't the goal: firings are paced
 * BACKFILL_FIRING_SPACING_MS apart anyway.
 */
const BACKFILL_TENANT_BATCH = 100;
const BACKFILL_MAX_BATCHES_PER_TICK = 10;
/*
 * How long a claim (rule_backfills.claimed_at) holds a backfill. A claim
 * older than this was abandoned (its process died mid-pass), and another
 * process may take the backfill over. Comfortably above the slowest
 * realistic pass (BACKFILL_MAX_BATCHES_PER_TICK batches); a pass that
 * outlives it is repeated harmlessly, since the cursor only moves forward
 * and firings dedupe.
 */
const BACKFILL_CLAIM_LEASE_MS = 60_000;
/**
 * The gap between a backfill's firings, as executor deadlines. Backfilled
 * tasks notify integrations like live ones, so this stays around the rate a
 * chat webhook accepts (about one message per second). Exported so a test
 * can check the pacing.
 */
export const BACKFILL_FIRING_SPACING_MS = 1_000;

type AssignmentRow = typeof assignments.$inferSelect;

/** A backfill claimed for one pass, with the claim stamp that releases it. */
type ClaimedBackfill = {
  backfill: typeof ruleBackfills.$inferSelect;
  claimedAtMs: number;
  rule: Rule;
};

/** Per-pass facts about the rule, read once. */
type PassContext = {
  /** Product lines whose billing periods are loaded, so the replay knows
   * which billing cycle a tenant was in at each past firing. Two things
   * read it: a firing quota per billing cycle (a billing_cycle_end
   * recurrence window), and microcredits_spent, whose spend total starts
   * over each billing cycle. Empty when the rule has no billing cycle to
   * read (see loadPassContext). */
  billingCycleProductLineIds: string[];
  /** The rule's meter's product lines. Together with planDefaults, gives a
   * tenant's initial allocation of the meter, which only "percentage of
   * initial allocation" thresholds read. Empty for lifecycle rules, which
   * have no meter. */
  meterProductLineIds: string[];
  /** Each plan's default allocation of the rule's meter. */
  planDefaults: Map<string, number>;
};

/** What the replay reads to judge one tenant as of a past time. */
type TenantHistory = {
  assignments: AssignmentRow[];
  /** The tenant's overrides of the rule's meter, oldest first. */
  overrides: { createdAt: number; defaultMicrocredits: number }[];
  /** The tenant's billing periods in PassContext.billingCycleProductLineIds. */
  periods: { periodEnd: number; periodStart: number; windowMs: number }[];
};

/** One firing the replay detected, before its recurrence check. */
type Detection = {
  /** The billing period containing occurredAt: only used to find which
   * firing quota window the firing counts toward (for billing_cycle_end
   * windows). */
  billingCycle: BillingCycle;
  occurredAt: number;
  payload: FiringPayload;
  /** The rule_runs trigger_key the firing is recorded under. */
  triggerKey: string;
};

/** A firing to record, with the billing cycle its recurrence window was
 * judged in. */
type BackfillFiring = { billingCycle: BillingCycle; firing: Firing };

/**
 * Claim a backfill for one pass, like the scheduler claims rules: one
 * another process claimed within BACKFILL_CLAIM_LEASE_MS is skipped. Pass a
 * ruleId to claim that rule's backfill only; null claims the oldest
 * unfinished one.
 */
async function claimBackfill({
  ruleId,
}: {
  ruleId: string | null;
}): Promise<ClaimedBackfill | null> {
  const claimedAtMs = Date.now();
  /* Select, then update by id, in one transaction, like the executor's
   * claim. A single UPDATE ... WHERE rule_id IN (SELECT ... LIMIT 1 FOR
   * UPDATE SKIP LOCKED) can re-run its subquery for each row it considers,
   * so it can claim several backfills while the caller only runs one,
   * leaving the rest unclaimable until their claimed_at is
   * BACKFILL_CLAIM_LEASE_MS old. */
  const backfill = await db.transaction(async (tx) => {
    const [claimable] = await tx
      .select({ ruleId: ruleBackfills.ruleId })
      .from(ruleBackfills)
      .where(
        and(
          isNull(ruleBackfills.completedAt),
          or(
            isNull(ruleBackfills.claimedAt),
            lt(ruleBackfills.claimedAt, claimedAtMs - BACKFILL_CLAIM_LEASE_MS),
          ),
          ruleId === null ? undefined : eq(ruleBackfills.ruleId, ruleId),
        ),
      )
      .orderBy(asc(ruleBackfills.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!claimable) {
      return null;
    }
    const [row] = await tx
      .update(ruleBackfills)
      .set({ claimedAt: claimedAtMs })
      .where(eq(ruleBackfills.ruleId, claimable.ruleId))
      .returning();
    return row ?? null;
  });
  if (backfill === null) {
    return null;
  }
  const [rule] = await db
    .select()
    .from(rules)
    .where(eq(rules.ruleId, backfill.ruleId));
  if (!rule) {
    // Unreachable in production: rules are deprecated, never deleted.
    console.error("rule backfill claimed for a missing rule", {
      ruleId: backfill.ruleId,
    });
    return null;
  }
  return { backfill, claimedAtMs, rule };
}

/** Release a claim (clear claimed_at), unless another process took the
 * backfill over because this pass ran longer than BACKFILL_CLAIM_LEASE_MS. */
async function releaseBackfill({
  claimed,
}: {
  claimed: ClaimedBackfill;
}): Promise<void> {
  await db
    .update(ruleBackfills)
    .set({ claimedAt: null })
    .where(
      and(
        eq(ruleBackfills.ruleId, claimed.rule.ruleId),
        eq(ruleBackfills.claimedAt, claimed.claimedAtMs),
      ),
    );
}

async function completeBackfill({
  claimed,
  reason,
}: {
  claimed: ClaimedBackfill;
  reason: "replayed" | "rule deprecated";
}): Promise<void> {
  const completedAt = Date.now();
  await db
    .update(ruleBackfills)
    .set({ completedAt })
    .where(eq(ruleBackfills.ruleId, claimed.rule.ruleId));
  console.log("rule backfill completed", {
    elapsedMs: completedAt - claimed.backfill.createdAt,
    reason,
    ruleId: claimed.rule.ruleId,
  });
}

/**
 * Has every source row from before the rule existed reached pg? Meter
 * events land in meter_events through the pending stream (flushed about
 * every second), and cycle_end reads billing periods the scheduler's
 * advance step writes. Replaying ahead of either would lose firings for
 * good: the cursor never revisits a tenant.
 */
async function sourcesCaughtUp({ rule }: { rule: Rule }): Promise<boolean> {
  const trigger = rule.trigger;
  switch (trigger.type) {
    case "relative_to_lifecycle_event": {
      if (trigger.relativeTo !== "cycle_end") {
        return true;
      }
      const frontierMs = await unadvancedFrontierMs();
      return (
        frontierMs === null ||
        frontierMs >= rule.createdAt - durationToMs(trigger.offset)
      );
    }
    case "inactive_for":
    case "microcredits_remaining":
    case "microcredits_spent": {
      /* The stream is in ingest order, so once its oldest entry was received
       * after the rule existed, every earlier event has been flushed. */
      const [oldest] = await redis.xrange(
        keys.pendingMeterEvents,
        "-",
        "+",
        "COUNT",
        1,
      );
      if (!oldest) {
        return true;
      }
      const { receivedAtMicroseconds } = parsePendingEntry({
        entryId: oldest[0],
        fields: oldest[1],
      });
      return (
        receivedAtMicroseconds !== null &&
        receivedAtMicroseconds >= rule.createdAt * MICROSECONDS_PER_MS
      );
    }
    default: {
      const exhaustive: never = trigger;
      throw new Error(`unknown rule trigger: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The rule's per-pass context: its meter's product lines, the product
 * lines its billing periods come from, and the plans' default allocations
 * of its meter. */
async function loadPassContext({ rule }: { rule: Rule }): Promise<PassContext> {
  const trigger = rule.trigger;
  switch (trigger.type) {
    case "relative_to_lifecycle_event": {
      /* Lifecycle rules watch invoices, assignments, and billing period
       * ends instead of a meter, so they have no percentage thresholds and
       * no meter product lines. The one thing they can need is the billing
       * cycle, for a firing quota per billing cycle (a billing_cycle_end
       * recurrence window), and that needs a single product line. Only a
       * plan scope can name one, since each plan belongs to one product
       * line. A global or tenant scope can't: a tenant can be on several
       * product lines at once, each with its own billing cycle. So
       * createRule only allows a billing_cycle_end window on a lifecycle
       * rule whose plan scope covers one product line, and every other
       * lifecycle rule never reads the billing cycle (windowStartMs only
       * reads it for billing_cycle_end). Same as the live scan
       * (scanLifecycleEvents in schedule.ts). */
      if (rule.scope.kind !== "plan") {
        return {
          billingCycleProductLineIds: [],
          meterProductLineIds: [],
          planDefaults: new Map(),
        };
      }
      const planRows = await db
        .select({ productLineId: plans.productLineId })
        .from(plans)
        .where(inArray(plans.planId, rule.scope.planIds));
      const lines = [...new Set(planRows.map((plan) => plan.productLineId))];
      return {
        billingCycleProductLineIds: lines.length === 1 ? lines : [],
        meterProductLineIds: [],
        planDefaults: new Map(),
      };
    }
    case "inactive_for":
    case "microcredits_remaining":
    case "microcredits_spent": {
      const [meterRow] = await db
        .select({ productLineIds: meters.productLineIds })
        .from(meters)
        .where(eq(meters.meterId, trigger.meterId));
      const defaultRows = await db
        .select({
          defaultMicrocredits: planMeters.defaultMicrocredits,
          planId: planMeters.planId,
        })
        .from(planMeters)
        .where(eq(planMeters.meterId, trigger.meterId));
      const meterProductLineIds = meterRow?.productLineIds ?? [];
      return {
        billingCycleProductLineIds: meterProductLineIds,
        meterProductLineIds,
        planDefaults: new Map(
          defaultRows.map((row) => [row.planId, row.defaultMicrocredits]),
        ),
      };
    }
    default: {
      const exhaustive: never = trigger;
      throw new Error(`unknown rule trigger: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The next batch of tenants past the cursor, in tenant_id order: the scoped
 * tenant alone, or else by trigger:
 *
 *   - relative_to_lifecycle_event: every tenant.
 *   - inactive_for: every tenant with an inactivity clock on the rule's
 *     meter (any tenant that ever had an assignment or an event on it).
 *   - microcredits_remaining / microcredits_spent: every tenant with a
 *     balance on the rule's meter, since a tenant can't spend without one.
 *     tenant_last_activity can miss some: a credit grant can give a tenant
 *     a balance on a meter outside their plan, and that tenant has no
 *     inactivity clock until checkpointMeterBalances copies their first
 *     event's activity, so a backfill before then would skip them for good.
 */
async function candidateTenantIds({
  afterTenantId,
  rule,
}: {
  afterTenantId: string;
  rule: Rule;
}): Promise<string[]> {
  const scope = rule.scope;
  if (scope.kind === "tenant") {
    return scope.tenantId > afterTenantId ? [scope.tenantId] : [];
  }
  const trigger = rule.trigger;
  switch (trigger.type) {
    case "relative_to_lifecycle_event": {
      const rows = await db
        .select({ tenantId: tenants.tenantId })
        .from(tenants)
        .where(gt(tenants.tenantId, afterTenantId))
        .orderBy(asc(tenants.tenantId))
        .limit(BACKFILL_TENANT_BATCH);
      return rows.map((row) => row.tenantId);
    }
    case "inactive_for": {
      const rows = await db
        .select({ tenantId: tenantLastActivity.tenantId })
        .from(tenantLastActivity)
        .where(
          and(
            eq(tenantLastActivity.meterId, trigger.meterId),
            gt(tenantLastActivity.tenantId, afterTenantId),
          ),
        )
        .orderBy(asc(tenantLastActivity.tenantId))
        .limit(BACKFILL_TENANT_BATCH);
      return rows.map((row) => row.tenantId);
    }
    case "microcredits_remaining":
    case "microcredits_spent": {
      const rows = await db
        .select({ tenantId: meterBalances.tenantId })
        .from(meterBalances)
        .where(
          and(
            eq(meterBalances.meterId, trigger.meterId),
            gt(meterBalances.tenantId, afterTenantId),
          ),
        )
        .orderBy(asc(meterBalances.tenantId))
        .limit(BACKFILL_TENANT_BATCH);
      return rows.map((row) => row.tenantId);
    }
    default: {
      const exhaustive: never = trigger;
      throw new Error(`unknown rule trigger: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Read the batch's assignments, billing periods, and meter overrides once,
 * keyed by tenant. */
async function loadHistories({
  context,
  meterId,
  tenantIds,
}: {
  context: PassContext;
  meterId: string | null;
  tenantIds: string[];
}): Promise<Map<string, TenantHistory>> {
  const histories = new Map<string, TenantHistory>(
    tenantIds.map((tenantId) => [
      tenantId,
      { assignments: [], overrides: [], periods: [] },
    ]),
  );
  const assignmentRows = await db
    .select()
    .from(assignments)
    .where(inArray(assignments.tenantId, tenantIds));
  for (const row of assignmentRows) {
    histories.get(row.tenantId)?.assignments.push(row);
  }
  if (context.billingCycleProductLineIds.length > 0) {
    const periodRows = await db
      .select({
        periodEnd: billingPeriods.periodEnd,
        periodStart: billingPeriods.periodStart,
        tenantId: billingPeriods.tenantId,
        windowMs: billingPeriods.windowMs,
      })
      .from(billingPeriods)
      .where(
        and(
          inArray(billingPeriods.tenantId, tenantIds),
          inArray(
            billingPeriods.productLineId,
            context.billingCycleProductLineIds,
          ),
        ),
      );
    for (const row of periodRows) {
      histories.get(row.tenantId)?.periods.push(row);
    }
  }
  if (meterId !== null) {
    const overrideRows = await db
      .select({
        createdAt: meterOverrides.createdAt,
        defaultMicrocredits: meterOverrides.defaultMicrocredits,
        tenantId: meterOverrides.tenantId,
      })
      .from(meterOverrides)
      .where(
        and(
          eq(meterOverrides.meterId, meterId),
          inArray(meterOverrides.tenantId, tenantIds),
        ),
      )
      .orderBy(asc(meterOverrides.createdAt));
    for (const row of overrideRows) {
      histories.get(row.tenantId)?.overrides.push(row);
    }
  }
  return histories;
}

/** Was the assignment active at atMs: started, and not yet ended? */
function assignmentOpenAt({
  assignment,
  atMs,
}: {
  assignment: AssignmentRow;
  atMs: number;
}): boolean {
  return (
    assignment.startsAt <= atMs &&
    (assignment.endsAt === null || assignment.endsAt > atMs)
  );
}

/**
 * The billing period containing atMs, as a recurrence-window anchor
 * (windowStartMs then lands exactly on its start). When a plan change
 * overlapped two periods, the later-starting one belongs to the newer
 * assignment, which is the one the live engine anchors to. Null when the
 * tenant had no recurring cycle then.
 */
function billingCycleAt({
  atMs,
  history,
}: {
  atMs: number;
  history: TenantHistory;
}): BillingCycle {
  let containing: TenantHistory["periods"][number] | null = null;
  for (const period of history.periods) {
    if (period.periodStart > atMs || atMs >= period.periodEnd) {
      continue;
    }
    if (containing === null || period.periodStart > containing.periodStart) {
      containing = period;
    }
  }
  return containing === null
    ? null
    : { anchorMs: containing.periodStart, windowMs: containing.windowMs };
}

/**
 * Did the rule's scope cover the tenant at atMs, by the scheduler's rule
 * (tenantsInScope in schedule.ts)? That takes an open assignment -- on one
 * of the scope's plans, for a plan scope.
 */
function inScheduledScopeAt({
  atMs,
  history,
  rule,
  tenantId,
}: {
  atMs: number;
  history: TenantHistory;
  rule: Rule;
  tenantId: string;
}): boolean {
  const scope = rule.scope;
  if (scope.kind === "tenant" && scope.tenantId !== tenantId) {
    return false;
  }
  return history.assignments.some(
    (assignment) =>
      assignmentOpenAt({ assignment, atMs }) &&
      (scope.kind !== "plan" || scope.planIds.includes(assignment.planId)),
  );
}

/** Did the rule's scope cover the tenant at atMs, by the meter-event rule
 * (resolveWatchSet in evaluate.ts)? */
function inWatchedScopeAt({
  atMs,
  history,
  rule,
  tenantId,
}: {
  atMs: number;
  history: TenantHistory;
  rule: Rule;
  tenantId: string;
}): boolean {
  return ruleAppliesToTenant({
    currentPlanIds: history.assignments
      .filter((assignment) => assignmentOpenAt({ assignment, atMs }))
      .map((assignment) => assignment.planId),
    rule,
    tenantId,
  });
}

/**
 * The tenant's initial allocation of the meter at atMs, the way
 * resolveWatchSet resolves it now: the latest override created by then,
 * else the plan default of the latest-started assignment open then in one
 * of the meter's product lines whose plan configures the meter.
 */
function allocationAt({
  atMs,
  context,
  history,
}: {
  atMs: number;
  context: PassContext;
  history: TenantHistory;
}): number | null {
  let override: TenantHistory["overrides"][number] | null = null;
  for (const candidate of history.overrides) {
    if (candidate.createdAt <= atMs) {
      override = candidate;
    }
  }
  if (override !== null) {
    return override.defaultMicrocredits;
  }
  let latest: AssignmentRow | null = null;
  for (const assignment of history.assignments) {
    if (
      !assignmentOpenAt({ assignment, atMs }) ||
      !context.meterProductLineIds.includes(assignment.productLineId) ||
      !context.planDefaults.has(assignment.planId)
    ) {
      continue;
    }
    if (latest === null || assignment.startsAt > latest.startsAt) {
      latest = assignment;
    }
  }
  return latest === null
    ? null
    : (context.planDefaults.get(latest.planId) ?? null);
}

/** A stretch of a tenant's history with one resolved threshold, in the microseconds
 * meter events are stamped in. Field names match the SQL record below. */
type ThresholdSegment = {
  from_microseconds: number;
  tenant_id: string;
  threshold: number;
  to_microseconds: number;
};

/**
 * A credit rule's threshold over one tenant's history, as segments. An
 * absolute amount holds throughout; a percentage of the initial allocation
 * changes whenever the allocation could have (an assignment starting or
 * ending, an override). Stretches with no allocation get no segment: a
 * percentage can't resolve there, so the rule couldn't have fired, the
 * same as live.
 */
function thresholdSegments({
  at,
  boundaryMs,
  context,
  history,
  tenantId,
}: {
  at: { absolute: number } | { percentageOfInitialAllocation: number };
  boundaryMs: number;
  context: PassContext;
  history: TenantHistory;
  tenantId: string;
}): ThresholdSegment[] {
  if ("absolute" in at) {
    return [
      {
        from_microseconds: 0,
        tenant_id: tenantId,
        threshold: at.absolute,
        to_microseconds: boundaryMs * MICROSECONDS_PER_MS,
      },
    ];
  }
  const changes = new Set<number>([0]);
  for (const assignment of history.assignments) {
    changes.add(assignment.startsAt);
    if (assignment.endsAt !== null) {
      changes.add(assignment.endsAt);
    }
  }
  for (const override of history.overrides) {
    changes.add(override.createdAt);
  }
  const starts = [...changes]
    .filter((ms) => ms < boundaryMs)
    .sort((a, b) => a - b);
  const segments: ThresholdSegment[] = [];
  for (const [i, fromMs] of starts.entries()) {
    const allocation = allocationAt({ atMs: fromMs, context, history });
    if (allocation === null) {
      continue;
    }
    segments.push({
      from_microseconds: fromMs * MICROSECONDS_PER_MS,
      tenant_id: tenantId,
      threshold: Math.floor(
        (allocation * at.percentageOfInitialAllocation) / 100,
      ),
      to_microseconds: (starts[i + 1] ?? boundaryMs) * MICROSECONDS_PER_MS,
    });
  }
  return segments;
}

function addDetection({
  detection,
  detectionsByTenant,
  tenantId,
}: {
  detection: Detection;
  detectionsByTenant: Map<string, Detection[]>;
  tenantId: string;
}): void {
  const tenantDetections = detectionsByTenant.get(tenantId) ?? [];
  tenantDetections.push(detection);
  detectionsByTenant.set(tenantId, tenantDetections);
}

/**
 * inactive_for: the batch's quiet spells whose window finished before the
 * rule existed. A tenant's activity is every write that moves its
 * inactivity clock, in the order they happened: each event at its
 * received time, and each assignment's clock start, written at the
 * assignment's creation with value max(startsAt, createdAt)
 * (seedInactivityForAssignment). The clock reads the latest value written
 * so far. A spell is one clock reading; it fires one window later, unless
 * a write moves the clock first -- the same inclusive comparison the live
 * scan makes (last activity <= now - window). Writes from after the rule
 * existed can't matter: they come after every backfilled spell's window.
 */
async function inactiveDetections({
  histories,
  rule,
  tenantIds,
}: {
  histories: Map<string, TenantHistory>;
  rule: Rule;
  tenantIds: string[];
}): Promise<Map<string, Detection[]>> {
  const trigger = rule.trigger;
  const detectionsByTenant = new Map<string, Detection[]>();
  if (trigger.type !== "inactive_for") {
    return detectionsByTenant;
  }
  const boundaryMicroseconds = rule.createdAt * MICROSECONDS_PER_MS;
  const windowMicroseconds =
    durationToMs(trigger.duration) * MICROSECONDS_PER_MS;
  const rows = await db.execute<{ latest: string; tenant_id: string }>(sql`
    with writes as (
      select tenant_id, received_at_microseconds as written_at,
        received_at_microseconds as activity_at
      from ${meterEvents}
      where meter_id = ${trigger.meterId}
        and tenant_id in ${tenantIds}
        and received_at_microseconds < ${boundaryMicroseconds}::bigint
      union all
      select a.tenant_id, a.created_at * ${MICROSECONDS_PER_MS}::bigint,
        greatest(a.starts_at, a.created_at) * ${MICROSECONDS_PER_MS}::bigint
      from ${assignments} as a
      join ${planMeters} as pm on pm.plan_id = a.plan_id
      where pm.meter_id = ${trigger.meterId}
        and a.tenant_id in ${tenantIds}
        and a.created_at * ${MICROSECONDS_PER_MS}::bigint < ${boundaryMicroseconds}::bigint
    ),
    clock as (
      select tenant_id, written_at,
        max(activity_at) over (
          partition by tenant_id order by written_at
          rows between unbounded preceding and current row
        ) as latest
      from writes
    ),
    spells as (
      select tenant_id, latest, min(written_at) as began_at
      from clock
      group by tenant_id, latest
    ),
    ordered as (
      select tenant_id, latest,
        lead(began_at) over (partition by tenant_id order by latest)
          as next_began_at
      from spells
    )
    select tenant_id, latest
    from ordered
    where latest + ${windowMicroseconds}::bigint < ${boundaryMicroseconds}::bigint
      and (next_began_at is null
        or next_began_at >= latest + ${windowMicroseconds}::bigint)
  `);
  for (const row of rows) {
    const history = histories.get(row.tenant_id);
    const lastAtMicroseconds = Number(row.latest);
    const occurredAt = Math.floor(
      (lastAtMicroseconds + windowMicroseconds) / MICROSECONDS_PER_MS,
    );
    if (
      !history ||
      !inScheduledScopeAt({
        atMs: occurredAt,
        history,
        rule,
        tenantId: row.tenant_id,
      })
    ) {
      continue;
    }
    addDetection({
      detection: {
        billingCycle: billingCycleAt({ atMs: occurredAt, history }),
        occurredAt,
        payload: {
          type: "inactive_for",
          meterId: trigger.meterId,
          occurredAt,
          backfilled: true,
        },
        triggerKey: inactiveTriggerKey({ lastAtMicroseconds }),
      },
      detectionsByTenant,
      tenantId: row.tenant_id,
    });
  }
  return detectionsByTenant;
}

/**
 * microcredits_remaining: the batch's events that took a balance from
 * above the threshold to at or below it, using the balance the ingest
 * script stored on each event. SQL narrows to crossings within each
 * threshold segment; crossedRemainingThreshold makes the final call.
 */
async function remainingDetections({
  context,
  histories,
  rule,
  tenantIds,
}: {
  context: PassContext;
  histories: Map<string, TenantHistory>;
  rule: Rule;
  tenantIds: string[];
}): Promise<Map<string, Detection[]>> {
  const trigger = rule.trigger;
  const detectionsByTenant = new Map<string, Detection[]>();
  if (trigger.type !== "microcredits_remaining") {
    return detectionsByTenant;
  }
  const boundaryMicroseconds = rule.createdAt * MICROSECONDS_PER_MS;
  const segments = tenantIds.flatMap((tenantId) => {
    const history = histories.get(tenantId);
    return history
      ? thresholdSegments({
          at: trigger.at,
          boundaryMs: rule.createdAt,
          context,
          history,
          tenantId,
        })
      : [];
  });
  if (segments.length === 0) {
    return detectionsByTenant;
  }
  const rows = await db.execute<{
    amount_microcredits: string;
    balance_after_microcredits: string;
    external_id: string;
    received_at_microseconds: string;
    tenant_id: string;
    threshold: string;
  }>(sql`
    select me.tenant_id, me.external_id, me.received_at_microseconds,
      me.amount_microcredits, me.balance_after_microcredits, seg.threshold
    from ${meterEvents} as me
    join jsonb_to_recordset(${JSON.stringify(segments)}::jsonb)
      as seg(tenant_id text, from_microseconds bigint, to_microseconds bigint,
        threshold bigint)
      on seg.tenant_id = me.tenant_id
      and me.received_at_microseconds >= seg.from_microseconds
      and me.received_at_microseconds < seg.to_microseconds
    where me.meter_id = ${trigger.meterId}
      and me.tenant_id in ${tenantIds}
      and me.status = 'succeeded'
      and me.received_at_microseconds < ${boundaryMicroseconds}::bigint
      and me.balance_after_microcredits <= seg.threshold
      and me.balance_after_microcredits + me.amount_microcredits
        > seg.threshold
  `);
  for (const row of rows) {
    const history = histories.get(row.tenant_id);
    const balanceMicrocredits = Number(row.balance_after_microcredits);
    const thresholdMicrocredits = Number(row.threshold);
    const occurredAt = Math.floor(
      Number(row.received_at_microseconds) / MICROSECONDS_PER_MS,
    );
    const crossed = crossedRemainingThreshold({
      balanceMicrocredits,
      event: {
        amountMicrocredits: Number(row.amount_microcredits),
        balanceMicrocredits,
        externalId: row.external_id,
        meterId: trigger.meterId,
        status: "succeeded",
        tenantId: row.tenant_id,
      },
      thresholdMicrocredits,
    });
    if (
      !history ||
      !crossed ||
      !inWatchedScopeAt({
        atMs: occurredAt,
        history,
        rule,
        tenantId: row.tenant_id,
      })
    ) {
      continue;
    }
    const payload: FiringPayload = {
      type: "microcredits_remaining",
      meterId: trigger.meterId,
      balanceMicrocredits,
      thresholdMicrocredits,
      occurredAt,
      backfilled: true,
    };
    addDetection({
      detection: {
        billingCycle: billingCycleAt({ atMs: occurredAt, history }),
        occurredAt,
        payload,
        triggerKey: meterEventTriggerKey({
          externalId: row.external_id,
          payload,
        }),
      },
      detectionsByTenant,
      tenantId: row.tenant_id,
    });
  }
  return detectionsByTenant;
}

/**
 * microcredits_spent: the batch's events that took spend from below the
 * threshold to at or above it. Spend is the running total of succeeded
 * events within the billing period the event fell in, or over all time
 * when no period contained it -- what live evaluation reads when the
 * tenant has no cycle. SQL narrows to crossings within each threshold
 * segment; crossedSpendThreshold makes the final call.
 */
async function spentDetections({
  context,
  histories,
  rule,
  tenantIds,
}: {
  context: PassContext;
  histories: Map<string, TenantHistory>;
  rule: Rule;
  tenantIds: string[];
}): Promise<Map<string, Detection[]>> {
  const trigger = rule.trigger;
  const detectionsByTenant = new Map<string, Detection[]>();
  if (trigger.type !== "microcredits_spent") {
    return detectionsByTenant;
  }
  const boundaryMicroseconds = rule.createdAt * MICROSECONDS_PER_MS;
  const segments = tenantIds.flatMap((tenantId) => {
    const history = histories.get(tenantId);
    return history
      ? thresholdSegments({
          at: trigger.at,
          boundaryMs: rule.createdAt,
          context,
          history,
          tenantId,
        })
      : [];
  });
  if (segments.length === 0) {
    return detectionsByTenant;
  }
  /* The period containing each event; the later-starting one when a plan
   * change overlapped two (see billingCycleAt). */
  const periodStart =
    context.billingCycleProductLineIds.length === 0
      ? sql`null::bigint`
      : sql`(
          select bp.period_start
          from ${billingPeriods} as bp
          where bp.tenant_id = me.tenant_id
            and bp.product_line_id in ${context.billingCycleProductLineIds}
            and bp.period_start * ${MICROSECONDS_PER_MS}::bigint
              <= me.received_at_microseconds
            and me.received_at_microseconds
              < bp.period_end * ${MICROSECONDS_PER_MS}::bigint
          order by bp.period_start desc
          limit 1
        )`;
  const rows = await db.execute<{
    amount_microcredits: string;
    external_id: string;
    received_at_microseconds: string;
    spent: string;
    tenant_id: string;
    threshold: string;
  }>(sql`
    with events as (
      select me.tenant_id, me.external_id, me.received_at_microseconds,
        me.amount_microcredits, ${periodStart} as period_start
      from ${meterEvents} as me
      where me.meter_id = ${trigger.meterId}
        and me.tenant_id in ${tenantIds}
        and me.status = 'succeeded'
        and me.received_at_microseconds < ${boundaryMicroseconds}::bigint
    ),
    spend as (
      select events.*,
        case when period_start is null
          then sum(amount_microcredits) over (
            partition by tenant_id
            order by received_at_microseconds, external_id
            rows between unbounded preceding and current row)
          else sum(amount_microcredits) over (
            partition by tenant_id, period_start
            order by received_at_microseconds, external_id
            rows between unbounded preceding and current row)
        end as spent
      from events
    )
    select spend.tenant_id, spend.external_id, spend.received_at_microseconds,
      spend.amount_microcredits, spend.spent, seg.threshold
    from spend
    join jsonb_to_recordset(${JSON.stringify(segments)}::jsonb)
      as seg(tenant_id text, from_microseconds bigint, to_microseconds bigint,
        threshold bigint)
      on seg.tenant_id = spend.tenant_id
      and spend.received_at_microseconds >= seg.from_microseconds
      and spend.received_at_microseconds < seg.to_microseconds
    where spend.spent >= seg.threshold
      and spend.spent - spend.amount_microcredits < seg.threshold
  `);
  for (const row of rows) {
    const history = histories.get(row.tenant_id);
    const spentMicrocredits = Number(row.spent);
    const thresholdMicrocredits = Number(row.threshold);
    const occurredAt = Math.floor(
      Number(row.received_at_microseconds) / MICROSECONDS_PER_MS,
    );
    const crossed = crossedSpendThreshold({
      event: {
        amountMicrocredits: Number(row.amount_microcredits),
        balanceMicrocredits: null,
        externalId: row.external_id,
        meterId: trigger.meterId,
        status: "succeeded",
        tenantId: row.tenant_id,
      },
      spentMicrocredits,
      thresholdMicrocredits,
    });
    if (
      !history ||
      !crossed ||
      !inWatchedScopeAt({
        atMs: occurredAt,
        history,
        rule,
        tenantId: row.tenant_id,
      })
    ) {
      continue;
    }
    const payload: FiringPayload = {
      type: "microcredits_spent",
      meterId: trigger.meterId,
      spentMicrocredits,
      thresholdMicrocredits,
      occurredAt,
      backfilled: true,
    };
    addDetection({
      detection: {
        billingCycle: billingCycleAt({ atMs: occurredAt, history }),
        occurredAt,
        payload,
        triggerKey: meterEventTriggerKey({
          externalId: row.external_id,
          payload,
        }),
      },
      detectionsByTenant,
      tenantId: row.tenant_id,
    });
  }
  return detectionsByTenant;
}

/**
 * relative_to_lifecycle_event: the batch's events whose fire time (event
 * time + offset) came before the rule existed -- the rows the live
 * scheduler's starting bookmark skips. Scope and keys follow the live
 * scans: invoice events check the tenant's assignments at fire time
 * (global rules skip the check), assignment_started and cycle_end match
 * the row's own plan, and a cycle_end receipt anchors its own window.
 */
async function lifecycleDetections({
  histories,
  rule,
  tenantIds,
}: {
  histories: Map<string, TenantHistory>;
  rule: Rule;
  tenantIds: string[];
}): Promise<Map<string, Detection[]>> {
  const trigger = rule.trigger;
  const detectionsByTenant = new Map<string, Detection[]>();
  if (trigger.type !== "relative_to_lifecycle_event") {
    return detectionsByTenant;
  }
  const { relativeTo } = trigger;
  const offsetMs = durationToMs(trigger.offset);
  const cutoffMs = rule.createdAt - offsetMs;
  const scope = rule.scope;
  const rowPlanInScope = ({
    planId,
    tenantId,
  }: {
    planId: string;
    tenantId: string;
  }): boolean => {
    if (scope.kind === "global") {
      return true;
    }
    if (scope.kind === "tenant") {
      return tenantId === scope.tenantId;
    }
    return scope.planIds.includes(planId);
  };
  const add = ({
    billingCycle,
    event,
    triggerKey,
  }: {
    billingCycle: BillingCycle;
    event: LifecycleEvent;
    triggerKey: string;
  }): void => {
    const occurredAt = event.eventAtMs + offsetMs;
    addDetection({
      detection: {
        billingCycle,
        occurredAt,
        payload: {
          type: "relative_to_lifecycle_event",
          invoiceId: event.invoiceId,
          assignmentId: event.assignmentId,
          occurredAt,
          backfilled: true,
        },
        triggerKey,
      },
      detectionsByTenant,
      tenantId: event.tenantId,
    });
  };
  if (relativeTo === "invoice_finalized" || relativeTo === "invoice_due") {
    // The same event time the live scan reads (see readInvoiceDueEvents).
    const eventAtColumn =
      relativeTo === "invoice_finalized"
        ? invoices.finalizedAt
        : invoices.dueAt;
    const rows = await db
      .select()
      .from(invoices)
      .where(
        and(
          inArray(invoices.tenantId, tenantIds),
          isNotNull(eventAtColumn),
          lt(eventAtColumn, cutoffMs),
        ),
      );
    for (const invoice of rows) {
      const history = histories.get(invoice.tenantId);
      const eventAtMs =
        relativeTo === "invoice_finalized"
          ? invoice.finalizedAt
          : invoice.dueAt;
      if (eventAtMs === null || !history) {
        continue;
      }
      const event: LifecycleEvent = {
        eventAtMs,
        eventId: invoice.invoiceId,
        tenantId: invoice.tenantId,
        planId: null,
        invoiceId: invoice.invoiceId,
        assignmentId: null,
      };
      const occurredAt = event.eventAtMs + offsetMs;
      if (
        scope.kind !== "global" &&
        !inScheduledScopeAt({
          atMs: occurredAt,
          history,
          rule,
          tenantId: invoice.tenantId,
        })
      ) {
        continue;
      }
      add({
        billingCycle: billingCycleAt({ atMs: occurredAt, history }),
        event,
        triggerKey: lifecycleEventTriggerKey({ event, relativeTo }),
      });
    }
    return detectionsByTenant;
  }
  if (relativeTo === "assignment_started") {
    const rows = await db
      .select()
      .from(assignments)
      .where(
        and(
          inArray(assignments.tenantId, tenantIds),
          lt(assignments.startsAt, cutoffMs),
        ),
      );
    for (const assignment of rows) {
      const history = histories.get(assignment.tenantId);
      if (
        !history ||
        !rowPlanInScope({
          planId: assignment.planId,
          tenantId: assignment.tenantId,
        })
      ) {
        continue;
      }
      const event: LifecycleEvent = {
        eventAtMs: assignment.startsAt,
        eventId: assignment.assignmentId,
        tenantId: assignment.tenantId,
        planId: assignment.planId,
        invoiceId: null,
        assignmentId: assignment.assignmentId,
      };
      add({
        billingCycle: billingCycleAt({
          atMs: event.eventAtMs + offsetMs,
          history,
        }),
        event,
        triggerKey: lifecycleEventTriggerKey({ event, relativeTo }),
      });
    }
    return detectionsByTenant;
  }
  if (relativeTo === "cycle_end") {
    const rows = await db
      .select({
        assignmentId: billingPeriods.assignmentId,
        periodEnd: billingPeriods.periodEnd,
        periodStart: billingPeriods.periodStart,
        planId: assignments.planId,
        tenantId: billingPeriods.tenantId,
        windowMs: billingPeriods.windowMs,
      })
      .from(billingPeriods)
      .innerJoin(
        assignments,
        eq(assignments.assignmentId, billingPeriods.assignmentId),
      )
      .where(
        and(
          inArray(billingPeriods.tenantId, tenantIds),
          lt(billingPeriods.periodEnd, cutoffMs),
          /* Every billing period the tenant started, even one its
           * assignment ended partway through; see scanCycleEnds. */
          or(
            isNull(assignments.endsAt),
            gt(assignments.endsAt, billingPeriods.periodStart),
          ),
        ),
      );
    for (const receipt of rows) {
      if (
        !rowPlanInScope({ planId: receipt.planId, tenantId: receipt.tenantId })
      ) {
        continue;
      }
      add({
        billingCycle: {
          anchorMs: receipt.periodStart,
          windowMs: receipt.windowMs,
        },
        event: {
          eventAtMs: receipt.periodEnd,
          eventId: receipt.assignmentId,
          tenantId: receipt.tenantId,
          planId: receipt.planId,
          invoiceId: null,
          assignmentId: receipt.assignmentId,
        },
        triggerKey: cycleEndTriggerKey({
          assignmentId: receipt.assignmentId,
          periodStart: receipt.periodStart,
        }),
      });
    }
    return detectionsByTenant;
  }
  const exhaustive: never = relativeTo;
  throw new Error(`unknown lifecycle event: ${JSON.stringify(exhaustive)}`);
}

/**
 * One tenant's firings from its detections, as if the rule had existed:
 * in time order, each checked against the rule's recurrence limit for the
 * window it happened in (windowStartMs and firingLimit, the same rule
 * takeFiringQuotaToken applies live). Nothing live exists before the rule
 * did, so the accepted list is the whole count. once_per_tenant keeps the
 * latest.
 */
function acceptedDetections({
  detections,
  rule,
}: {
  detections: Detection[];
  rule: Rule;
}): Detection[] {
  const sorted = [...detections].sort(
    (a, b) =>
      a.occurredAt - b.occurredAt || a.triggerKey.localeCompare(b.triggerKey),
  );
  const limit = firingLimit({ recurrence: rule.recurrence });
  const accepted: Detection[] = [];
  for (const detection of sorted) {
    if (limit !== null) {
      const windowStart = windowStartMs({
        billingCycle: detection.billingCycle,
        now: detection.occurredAt,
        window: rule.recurrence.window,
      });
      /* accepted is in time order, so the window already holds `limit`
       * firings exactly when the limit-th latest one falls inside it. */
      if (
        accepted.length >= limit &&
        accepted[accepted.length - limit].occurredAt >= windowStart
      ) {
        continue;
      }
    }
    accepted.push(detection);
  }
  switch (rule.backfill) {
    case "every_firing":
      return accepted;
    case "once_per_tenant":
      return accepted.slice(-1);
    case "none":
      return [];
    default: {
      const exhaustive: never = rule.backfill;
      throw new Error(`unknown rule backfill: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Replay one batch of tenants into the firings to record, in tenant then
 * time order. */
async function replayBatch({
  context,
  rule,
  tenantIds,
}: {
  context: PassContext;
  rule: Rule;
  tenantIds: string[];
}): Promise<BackfillFiring[]> {
  const trigger = rule.trigger;
  const histories = await loadHistories({
    context,
    meterId:
      trigger.type === "relative_to_lifecycle_event" ? null : trigger.meterId,
    tenantIds,
  });
  let detectionsByTenant: Map<string, Detection[]>;
  switch (trigger.type) {
    case "inactive_for":
      detectionsByTenant = await inactiveDetections({
        histories,
        rule,
        tenantIds,
      });
      break;
    case "microcredits_remaining":
      detectionsByTenant = await remainingDetections({
        context,
        histories,
        rule,
        tenantIds,
      });
      break;
    case "microcredits_spent":
      detectionsByTenant = await spentDetections({
        context,
        histories,
        rule,
        tenantIds,
      });
      break;
    case "relative_to_lifecycle_event":
      detectionsByTenant = await lifecycleDetections({
        histories,
        rule,
        tenantIds,
      });
      break;
    default: {
      const exhaustive: never = trigger;
      throw new Error(`unknown rule trigger: ${JSON.stringify(exhaustive)}`);
    }
  }
  const firings: BackfillFiring[] = [];
  for (const tenantId of tenantIds) {
    const detections = detectionsByTenant.get(tenantId) ?? [];
    for (const detection of acceptedDetections({ detections, rule })) {
      firings.push({
        billingCycle: detection.billingCycle,
        firing: {
          rule,
          tenantId,
          triggerKey: detection.triggerKey,
          occurredAt: detection.occurredAt,
          payload: detection.payload,
        },
      });
    }
  }
  return firings;
}

/** Move the cursor and nextAvailableAt forward. Forward-only, so a pass
 * that ran longer than BACKFILL_CLAIM_LEASE_MS, and was taken over, can't
 * move them back behind the newer pass. */
async function saveProgress({
  client,
  cursorTenantId,
  nextAvailableAt,
  ruleId,
}: {
  client: Pick<typeof db, "update">;
  cursorTenantId: string;
  nextAvailableAt: number;
  ruleId: string;
}): Promise<void> {
  await client
    .update(ruleBackfills)
    .set({ cursorTenantId, nextAvailableAt })
    .where(
      and(
        eq(ruleBackfills.ruleId, ruleId),
        lt(ruleBackfills.cursorTenantId, cursorTenantId),
      ),
    );
}

/**
 * Record a batch's firings and move the cursor past its last tenant, in
 * one transaction. Each firing is due BACKFILL_FIRING_SPACING_MS after the
 * one before (never earlier than now), so the executor drains the backfill
 * at a fixed rate. Returns the nextAvailableAt for the next batch.
 */
async function recordBatch({
  cursorTenantId,
  firings,
  nextAvailableAt,
  rule,
}: {
  cursorTenantId: string;
  firings: BackfillFiring[];
  nextAvailableAt: number;
  rule: Rule;
}): Promise<number> {
  const now = Date.now();
  let deadline = nextAvailableAt;
  const rowsByTenant = new Map<string, ReturnType<typeof firingRuleRuns>>();
  for (const { firing } of firings) {
    const availableAt = Math.max(deadline, now);
    const tenantRows = rowsByTenant.get(firing.tenantId) ?? [];
    tenantRows.push(...firingRuleRuns({ availableAt, createdAt: now, firing }));
    rowsByTenant.set(firing.tenantId, tenantRows);
    deadline = availableAt + BACKFILL_FIRING_SPACING_MS;
  }
  try {
    await db.transaction(async (tx) => {
      await insertRuleRuns({
        client: tx,
        rows: [...rowsByTenant.values()].flat(),
      });
      await saveProgress({
        client: tx,
        cursorTenantId,
        nextAvailableAt: deadline,
        ruleId: rule.ruleId,
      });
    });
  } catch (error) {
    if (pgErrorCode({ error }) !== PG_FOREIGN_KEY_VIOLATION) {
      throw error;
    }
    /* A tenant garbage-collected (or a test rule deleted) mid-batch: its
     * runs can't reference it. Record tenant by tenant so only the firings
     * that can't land drop. */
    for (const [tenantId, rows] of rowsByTenant) {
      try {
        await db.transaction(async (tx) => {
          await insertRuleRuns({ client: tx, rows });
        });
      } catch (tenantError) {
        if (pgErrorCode({ error: tenantError }) !== PG_FOREIGN_KEY_VIOLATION) {
          throw tenantError;
        }
        console.error("rule backfill skipped firings: tenant or rule gone", {
          ruleId: rule.ruleId,
          tenantId,
        });
      }
    }
    await saveProgress({
      client: db,
      cursorTenantId,
      nextAvailableAt: deadline,
      ruleId: rule.ruleId,
    });
  }
  /* A live quota counter cached for a window these firings fall in would
   * undercount them; drop it so the next live check re-counts from
   * rule_runs. Rules with no limit keep no counters. */
  if (firingLimit({ recurrence: rule.recurrence }) !== null) {
    const quotaKeys = new Set(
      firings.map(({ billingCycle, firing }) =>
        keys.ruleFiringQuota({
          ruleId: rule.ruleId,
          tenantId: firing.tenantId,
          windowStart: windowStartMs({
            billingCycle,
            now: firing.occurredAt,
            window: rule.recurrence.window,
          }),
        }),
      ),
    );
    if (quotaKeys.size > 0) {
      await redis.del(...quotaKeys);
    }
  }
  return deadline;
}

/** Has the rule been deprecated since it was read? Checked before each
 * batch, so deprecating a rule stops its backfill within one batch. */
async function ruleDeprecated({
  ruleId,
}: {
  ruleId: string;
}): Promise<boolean> {
  const [row] = await db
    .select({ deprecatedAt: rules.deprecatedAt })
    .from(rules)
    .where(eq(rules.ruleId, ruleId));
  return !row || row.deprecatedAt !== null;
}

/**
 * One pass over a claimed backfill: up to BACKFILL_MAX_BATCHES_PER_TICK
 * batches of tenants, then stop and let the cursor carry the rest over.
 * Completes the backfill when the tenants run out, or as soon as the rule
 * is deprecated.
 */
async function runPass({
  claimed,
}: {
  claimed: ClaimedBackfill;
}): Promise<void> {
  const { rule } = claimed;
  if (rule.deprecatedAt !== null) {
    await completeBackfill({ claimed, reason: "rule deprecated" });
    return;
  }
  if (!(await sourcesCaughtUp({ rule }))) {
    console.log("rule backfill waiting for its sources to catch up", {
      ruleId: rule.ruleId,
    });
    return;
  }
  const context = await loadPassContext({ rule });
  let cursorTenantId = claimed.backfill.cursorTenantId;
  let nextAvailableAt = claimed.backfill.nextAvailableAt;
  let firingsRecorded = 0;
  let tenantsReplayed = 0;
  let finished = false;
  for (let batch = 0; batch < BACKFILL_MAX_BATCHES_PER_TICK; batch++) {
    if (batch > 0 && (await ruleDeprecated({ ruleId: rule.ruleId }))) {
      await completeBackfill({ claimed, reason: "rule deprecated" });
      return;
    }
    const tenantIds = await candidateTenantIds({
      afterTenantId: cursorTenantId,
      rule,
    });
    if (tenantIds.length === 0) {
      finished = true;
      break;
    }
    const firings = await replayBatch({ context, rule, tenantIds });
    cursorTenantId = tenantIds[tenantIds.length - 1];
    nextAvailableAt = await recordBatch({
      cursorTenantId,
      firings,
      nextAvailableAt,
      rule,
    });
    firingsRecorded += firings.length;
    tenantsReplayed += tenantIds.length;
    if (tenantIds.length < BACKFILL_TENANT_BATCH) {
      finished = true;
      break;
    }
  }
  console.log("rule backfill progress", {
    cursorTenantId,
    firingsRecorded,
    ruleId: rule.ruleId,
    tenantsReplayed,
  });
  if (finished) {
    await completeBackfill({ claimed, reason: "replayed" });
  }
}

/**
 * Claim one unfinished backfill and run a pass over it. Pass a ruleId to
 * work on that rule's backfill only (a test driving one rule); null takes
 * the oldest one no other process holds. Errors are logged, never thrown.
 */
export async function runRuleBackfillPass({
  ruleId,
}: {
  ruleId: string | null;
}): Promise<void> {
  const claimed = await claimBackfill({ ruleId });
  if (claimed === null) {
    return;
  }
  try {
    await runPass({ claimed });
  } catch (error) {
    console.error("rule backfill pass failed", {
      error,
      ruleId: claimed.rule.ruleId,
    });
  }
  try {
    await releaseBackfill({ claimed });
  } catch (error) {
    console.error("rule backfill claim release failed", {
      error,
      ruleId: claimed.rule.ruleId,
    });
  }
}

let backfillTickRunning = false;

/**
 * Start the backfill loop. The guard skips a beat when a tick overruns, so
 * ticks never overlap. Errors are logged, never thrown.
 */
export function startRuleBackfillLoop(): void {
  const loop = setInterval(() => {
    if (backfillTickRunning) {
      return;
    }
    backfillTickRunning = true;
    runRuleBackfillPass({ ruleId: null })
      .catch((error) => console.error("rule backfill tick failed", error))
      .finally(() => {
        backfillTickRunning = false;
      });
  }, BACKFILL_INTERVAL_MS);
  loop.unref();
}
