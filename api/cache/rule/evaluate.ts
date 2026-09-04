/**
 * cache/rule/evaluate.ts -- rule evaluation and firing.
 *
 * Rules generalize the kind of logic often seen in dunning: a trigger
 * condition plus actions, scoped global / plan / tenant. Scopes are additive:
 * every applicable rule (global, plus plan rules matching the tenant's
 * current plan, plus tenant rules) watches and fires independently -- a
 * tenant rule does not shadow a global one. Two evaluation paths:
 *
 *   - Event-time (microcredits_remaining, microcredits_spent):
 *     evaluateMeterEventRules runs in the meter-event hot path against a
 *     resolved watch set cached in Redis, so evaluation does no pg config
 *     reads per-event. resolveWatchSet does the pg-backed scope/plan/
 *     allocation resolution once and caches the result. Cumulative spend and
 *     firing quotas likewise read Redis counters (mspend:, rquota:) cached
 *     from pg, touching pg only to seed a cold window or a bounded
 *     pre-window gap.
 *   - Periodic (inactive_for, relative_to_lifecycle_event): the scheduler
 *     loop in cache/rule/schedule.ts scans candidate tenants and fires.
 *
 * Firing is durable: when a rule fires, its rule_runs rows are inserted
 * synchronously (onConflictDoNothing on the idempotency index), so a firing
 * is never lost even if the process crashes before the executor drains it.
 * The executor worker (cache/rule/execute.ts) then runs each action.
 *
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  assignments,
  cycles,
  meterOverrides,
  planMeters,
  ruleRuns,
  rules,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Duration } from "../../schemas/common.ts";
import type { MeterEvent } from "../../schemas/meter-event.ts";
import type { Rule, FiringPayload } from "../../schemas/rule.ts";
import { spendSince } from "../meter/index.ts";
import { redis } from "../index.ts";
import { keys } from "../keys.ts";

/** The subset of a rule relevant to a single tenant+meter, scope-resolved. */
export type WatchedRule = {
  /** The canonical stored rule (carries actions with value ids for firing). */
  rule: Rule;
  /**
   * For microcredits_remaining / microcredits_spent: the absolute threshold,
   * precomputed. Null for the scheduler-driven trigger types.
   */
  thresholdMicrocredits: number | null;
};

/**
 * The tenant's billing-cycle anchor, for "billing_cycle_end" recurrence
 * windows: the open assignment's startsAt and the cycle's length in ms.
 * Null when the tenant has no repeating cycle (no assignment / one_time).
 */
export type BillingCycle = { anchorMs: number; windowMs: number } | null;

export function durationToMs(duration: Duration): number {
  if (duration.days !== null) {
    return duration.days * 24 * 60 * 60 * 1000;
  }
  // Months are calendar units; for recurrence/inactivity windows a 30-day
  // approximation is fine (these are notification timings, not billing).
  return (duration.months ?? 0) * 30 * 24 * 60 * 60 * 1000;
}

/**
 * The tenant's billing-cycle anchor: the open assignment's start plus the
 * cycle's length. Null for one-time cycles and tenants with no assignment.
 * Shared by resolveWatchSet (event-time) and the scheduler.
 */
export async function getBillingCycle({
  tenantId,
}: {
  tenantId: string;
}): Promise<BillingCycle> {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.tenantId, tenantId), isNull(assignments.endsAt)));
  if (!assignment) {
    return null;
  }
  const [cycleRow] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.cycleId, assignment.cycleId))
    .limit(1);
  if (!cycleRow || cycleRow.cycleLength === "one_time") {
    return null;
  }
  return {
    anchorMs: assignment.startsAt,
    windowMs: durationToMs(cycleRow.cycleLength),
  };
}

/**
 * The billing-cycle anchor for many tenants in one query: the open
 * assignment's start plus the cycle's length, keyed by tenant. Tenants with
 * no open assignment or a one-time cycle are absent from the map. Used by the
 * scheduler so a tick does one pg round-trip, not one per candidate.
 */
export async function getBillingCycles({
  tenantIds,
}: {
  tenantIds: string[];
}): Promise<Map<string, NonNullable<BillingCycle>>> {
  const result = new Map<string, NonNullable<BillingCycle>>();
  if (tenantIds.length === 0) {
    return result;
  }
  const rows = await db
    .select({
      tenantId: assignments.tenantId,
      startsAt: assignments.startsAt,
      cycleLength: cycles.cycleLength,
    })
    .from(assignments)
    .innerJoin(cycles, eq(assignments.cycleId, cycles.cycleId))
    .where(
      and(inArray(assignments.tenantId, tenantIds), isNull(assignments.endsAt)),
    );
  for (const row of rows) {
    if (row.cycleLength === "one_time") {
      continue;
    }
    result.set(row.tenantId, {
      anchorMs: row.startsAt,
      windowMs: durationToMs(row.cycleLength),
    });
  }
  return result;
}

/** The scope-resolved watch set for a tenant+meter, plus the billing cycle. */
export type WatchSet = {
  rules: WatchedRule[];
  cycle: BillingCycle;
};

/**
 * Does this rule apply to the tenant, given their current plan (null when
 * they have no assignment)? Scopes are additive: global applies everywhere,
 * plan applies to tenants on that plan, tenant applies to that one tenant.
 * Shared by resolveWatchSet (event-time) and the scheduler.
 */
export function ruleAppliesToTenant({
  currentPlanId,
  rule,
  tenantId,
}: {
  currentPlanId: string | null;
  rule: Rule;
  tenantId: string;
}): boolean {
  if (rule.scope.kind === "global") {
    return true;
  }
  if (rule.scope.kind === "plan") {
    return currentPlanId !== null && rule.scope.planIds.includes(currentPlanId);
  }
  return rule.scope.tenantId === tenantId;
}

/**
 * Resolve the rules that apply to a tenant+meter into a watch set: all
 * applicable scopes (global, the tenant's current plan, the tenant itself),
 * with percentage amounts converted to absolute microcredits against the
 * initial allocation (effective defaultMicrocredits, override wins). Also
 * resolves the tenant's billing-cycle anchor for "billing_cycle_end"
 * recurrence windows. Cached in Redis so the meter-event hot path does a
 * single GET, never pg.
 */
export async function resolveWatchSet({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<WatchSet> {
  const allRules = await db
    .select()
    .from(rules)
    .where(isNull(rules.deprecatedAt));

  // The tenant's open assignment, for plan-scoped rules and the meter config.
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.tenantId, tenantId), isNull(assignments.endsAt)));

  // Scope filtering happens in TypeScript, not the SQL query: the rules
  // table is small (team-configured, not tenant-scale), this runs at most
  // once per WATCH_SET_TTL_MS per tenant+meter (cached in Redis), and the
  // plan-scope branch needs the assignment row fetched above anyway. Pushing
  // jsonb path predicates (scope->>'kind', trigger->>'meterId') into SQL
  // would be harder to read for no hot-path win.
  const applicable = allRules.filter((rule) =>
    ruleAppliesToTenant({
      currentPlanId: assignment?.planId ?? null,
      rule,
      tenantId,
    }),
  );

  const cycle = await getBillingCycle({ tenantId });

  // Initial allocation: the plan meter's default, with the latest override
  // winning (the same resolution entitlements use).
  let initialAllocationMicrocredits: number | null = null;
  if (assignment) {
    const [planMeter] = await db
      .select()
      .from(planMeters)
      .where(
        and(
          eq(planMeters.planId, assignment.planId),
          eq(planMeters.meterId, meterId),
        ),
      )
      .limit(1);
    initialAllocationMicrocredits = planMeter?.defaultMicrocredits ?? null;
  }
  const [override] = await db
    .select()
    .from(meterOverrides)
    .where(
      and(
        eq(meterOverrides.tenantId, tenantId),
        eq(meterOverrides.meterId, meterId),
      ),
    )
    .orderBy(desc(meterOverrides.createdAt))
    .limit(1);
  if (override) {
    initialAllocationMicrocredits = override.defaultMicrocredits;
  }

  // Resolve an absolute amount or a percentage of the initial allocation
  // into absolute microcredits. Null when it can't resolve (no allocation).
  const resolveAmount = (
    at: { absolute: number } | { percentageOfInitialAllocation: number },
  ): number | null => {
    if ("absolute" in at) {
      return at.absolute;
    }
    if (initialAllocationMicrocredits === null) {
      return null;
    }
    return Math.floor(
      (initialAllocationMicrocredits * at.percentageOfInitialAllocation) / 100,
    );
  };

  const watched: WatchedRule[] = [];
  for (const rule of applicable) {
    const trigger = rule.trigger;
    if (
      (trigger.type === "microcredits_remaining" ||
        trigger.type === "microcredits_spent") &&
      trigger.meterId === meterId
    ) {
      const thresholdMicrocredits = resolveAmount(trigger.at);
      if (thresholdMicrocredits === null) {
        // No initial allocation: a percentage amount can never resolve. Skip.
        continue;
      }
      watched.push({ rule, thresholdMicrocredits });
    }
  }
  return { rules: watched, cycle };
}

const WATCH_SET_TTL_MS = 60 * 1000;

/**
 * Read the watch set for a tenant+meter, populating the cache on a miss.
 * Negative results are cached too, so unruled meters cost the same GET.
 */
export async function getWatchSet({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<WatchSet> {
  const cacheKey = keys.ruleWatchSet({ meterId, tenantId });
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached) as WatchSet;
  }
  const resolved = await resolveWatchSet({ meterId, tenantId });
  await redis.set(cacheKey, JSON.stringify(resolved), "PX", WATCH_SET_TTL_MS);
  return resolved;
}

/** The idempotency key + observed facts for one firing of one rule for one tenant. */
export type Firing = {
  rule: Rule;
  tenantId: string;
  triggerKey: string;
  /** The facts the trigger observed at fire time; substituted into create_task templates. */
  payload: FiringPayload;
};

/**
 * Durably record a firing: one rule_runs row per action, inserted
 * synchronously with onConflictDoNothing on the (rule, tenant, triggerKey,
 * actionIndex) idempotency index. Repeat firings of the same triggerKey
 * insert nothing, so this is safe to call on every detection.
 */
export async function recordFiring({
  firing,
}: {
  firing: Firing;
}): Promise<void> {
  const now = Date.now();
  const rows = firing.rule.actions.map((_, actionIndex) => ({
    ruleRunId: generateId({ prefix: "rule_run" }),
    createdAt: now,
    ruleId: firing.rule.ruleId,
    tenantId: firing.tenantId,
    triggerKey: firing.triggerKey,
    actionIndex,
    payload: firing.payload,
    attempts: 0,
    availableAt: now,
    succeededAt: null,
    failedAt: null,
    lastError: null,
  }));
  if (rows.length === 0) {
    return;
  }
  await db.insert(ruleRuns).values(rows).onConflictDoNothing();
}

/** The start of the rule's current recurrence window, in ms since epoch. */
function windowStartMs({
  cycle,
  now,
  window,
}: {
  cycle: BillingCycle;
  now: number;
  window: Rule["recurrence"]["window"];
}): number {
  if (window === null) {
    // One permanent window: everything is in the same bucket.
    return 0;
  }
  if (window === "billing_cycle_end") {
    if (cycle === null || now < cycle.anchorMs) {
      return cycle?.anchorMs ?? 0;
    }
    // Aligned cycle start: the most recent multiple of windowMs after anchor.
    const elapsed = now - cycle.anchorMs;
    return (
      cycle.anchorMs + Math.floor(elapsed / cycle.windowMs) * cycle.windowMs
    );
  }
  // Rolling window: "the last N days/months" ending now.
  return now - durationToMs(window);
}

/**
 * Atomically consume one firing-quota token: INCR the per-window counter if
 * it's under the limit (ARGV[1]). Returns the new count, or -1 when the quota
 * is exhausted. The caller guarantees the key exists (seeding it from the pg
 * count on a cold window), so this never touches pg on the hot path. pg
 * (rule_runs) is the source of truth; the Redis counter is a cache of it.
 */
const QUOTA_CONSUME_LUA = `
  local current = tonumber(redis.call("GET", KEYS[1]))
  if current >= tonumber(ARGV[1]) then
    return -1
  end
  return redis.call("INCR", KEYS[1])
`;

/** How many times this rule+tenant has fired within the current window. */
async function countFiringsInWindow({
  ruleId,
  tenantId,
  windowStart,
}: {
  ruleId: string;
  tenantId: string;
  windowStart: number;
}): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${ruleRuns.triggerKey})` })
    .from(ruleRuns)
    .where(
      and(
        eq(ruleRuns.ruleId, ruleId),
        eq(ruleRuns.tenantId, tenantId),
        gte(ruleRuns.createdAt, windowStart),
      ),
    );
  return Number(row?.count ?? 0);
}

/**
 * Cap on quota-key lifetime for the permanent (null) window and for a
 * cycle-aligned window with no cycle to derive a length from. Matches the
 * inactivity lookback horizon: nothing should need a quota key older than
 * this, and a stale re-seed from pg is always correct.
 */
const QUOTA_TTL_CAP_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * How long a per-window quota key lives: the window's own duration, so the
 * key dies when its window closes. Rolling windows use the duration;
 * cycle-aligned use the cycle length (or the cap when there is no cycle);
 * the permanent window gets the cap so keys still expire eventually.
 */
function quotaTtlMs({
  cycle,
  window,
}: {
  cycle: BillingCycle;
  window: Rule["recurrence"]["window"];
}): number {
  if (window === null) {
    return QUOTA_TTL_CAP_MS;
  }
  if (window === "billing_cycle_end") {
    return cycle?.windowMs ?? QUOTA_TTL_CAP_MS;
  }
  return durationToMs(window);
}

/**
 * The firing gate shared by event-time and scheduler evaluation. Decides
 * whether a detected firing should be recorded, per the rule's recurrence:
 *
 *   - window: which window the quota is counted over.
 *   - rearmOnRecover: false = fire at most once per window (a recovery +
 *     re-cross does not re-open the window); true = each fresh crossing
 *     fires, up to limitRecurrences.
 *   - limitRecurrences: hard cap on firings per window (null = unlimited).
 *
 * The returned key is stable per firing instance (the event's external id,
 * or a scheduler instance key), so redelivery dedupes via the idempotency
 * index; the window cap is enforced by the rquota: counter consume, not the
 * key. Returns null to suppress.
 */
export async function firingKey({
  baseTriggerKey,
  cycle,
  firingId,
  rule,
  tenantId,
}: {
  baseTriggerKey: string;
  cycle: BillingCycle;
  /** Stable per firing instance: the event's external id, or a scheduler instance key. */
  firingId: string;
  rule: Rule;
  tenantId: string;
}): Promise<string | null> {
  const { recurrence } = rule;
  const windowStart = windowStartMs({
    cycle,
    now: Date.now(),
    window: recurrence.window,
  });
  // rearmOnRecover=false fires once per window; limitRecurrences caps the
  // rearm=true case. Both reduce to a single count check.
  const limit = recurrence.rearmOnRecover ? recurrence.limitRecurrences : 1;
  if (limit === null) {
    // Uncapped: no quota to enforce, so no counter to maintain.
    return `${baseTriggerKey}:${firingId}`;
  }
  const quotaKey = keys.ruleFiringQuota({
    ruleId: rule.ruleId,
    tenantId,
    windowStart,
  });
  // Hot path: the per-window counter already exists in Redis, so consume a
  // token with no pg read. Cold path (first firing in a window, or a cache
  // flush / pg-side change): seed the counter from the pg count first. pg
  // (rule_runs) is the source of truth; the Redis counter is a cache of it.
  // The TTL outlives the window so the key dies with it -- otherwise every
  // rule x tenant x window leaves an immortal key behind.
  if ((await redis.exists(quotaKey)) === 0) {
    await redis.set(
      quotaKey,
      await countFiringsInWindow({
        ruleId: rule.ruleId,
        tenantId,
        windowStart,
      }),
      "PX",
      quotaTtlMs({ cycle, window: recurrence.window }),
      "NX",
    );
  }
  const count = await redis.eval(QUOTA_CONSUME_LUA, 1, quotaKey, limit);
  if (Number(count) < 0) {
    return null;
  }
  return `${baseTriggerKey}:${firingId}`;
}

/** The meter-event facts rule evaluation needs, post-ingest. */
export type RecordedEvent = {
  amountMicrocredits: number;
  balanceMicrocredits: number | null;
  /** The event's idempotency key; used to dedupe firing on redelivery. */
  externalId: string;
  meterId: string;
  status: MeterEvent["status"];
  tenantId: string;
};

/**
 * Edge detection: did this charge move the balance from above the threshold
 * to at-or-below it? Refunds (negative) never cross downward.
 */
function crossedRemainingThreshold({
  balanceMicrocredits,
  event,
  thresholdMicrocredits,
}: {
  balanceMicrocredits: number;
  event: RecordedEvent;
  thresholdMicrocredits: number;
}): boolean {
  const previousBalance = balanceMicrocredits + event.amountMicrocredits;
  return (
    previousBalance > thresholdMicrocredits &&
    balanceMicrocredits <= thresholdMicrocredits
  );
}

/** The idempotency key for a firing payload's trigger family. */
function baseTriggerKeyFor({ payload }: { payload: FiringPayload }): string {
  switch (payload.type) {
    case "microcredits_remaining":
      return `microcredits_remaining:${payload.thresholdMicrocredits}`;
    case "microcredits_spent":
      return `microcredits_spent:${payload.thresholdMicrocredits}`;
    case "inactive_for":
      return "inactive_for";
    case "relative_to_lifecycle_event":
      return `relative_to_lifecycle_event:${payload.invoiceId}`;
  }
}

/**
 * Evaluate the watch set for a just-recorded event and fire matching rules.
 * The watch set carries the canonical stored rules and the billing cycle, so
 * evaluation needs no pg read for config -- only the synchronous rule_runs
 * insert on a firing. A microcredits_spent rule additionally needs the
 * cumulative spend for the current cycle, read from the mspend: counter
 * (durable meter_spends base + the Redis delta, already INCRBY'd by this
 * event) rather than a per-event pg sum; the only pg read is the bounded
 * pre-window gap when a cycle start landed after the last checkpoint.
 */
export async function evaluateMeterEventRules({
  event,
}: {
  event: RecordedEvent;
}): Promise<void> {
  if (event.status !== "succeeded" || event.amountMicrocredits <= 0) {
    return;
  }
  const { rules: watched, cycle } = await getWatchSet({
    meterId: event.meterId,
    tenantId: event.tenantId,
  });
  if (watched.length === 0) {
    return;
  }

  // Cumulative spend this billing cycle, computed once if any spent rule is
  // watched. Read from the spend counter (durable base + flush-lag delta);
  // the current event is already INCRBY'd into the counter by ingest.
  let spentMicrocredits: number | null = null;
  if (watched.some((r) => r.rule.trigger.type === "microcredits_spent")) {
    const cycleStartMicros =
      cycle === null
        ? 0
        : windowStartMs({
            cycle,
            now: Date.now(),
            window: "billing_cycle_end",
          }) * 1000;
    spentMicrocredits = await spendSince({
      meterId: event.meterId,
      sinceMicros: cycleStartMicros,
      tenantId: event.tenantId,
    });
  }

  for (const rule of watched) {
    const threshold = rule.thresholdMicrocredits;
    if (threshold === null) {
      continue;
    }
    const trigger = rule.rule.trigger;
    let payload: FiringPayload | null = null;
    if (
      trigger.type === "microcredits_remaining" &&
      event.balanceMicrocredits !== null &&
      crossedRemainingThreshold({
        balanceMicrocredits: event.balanceMicrocredits,
        event,
        thresholdMicrocredits: threshold,
      })
    ) {
      payload = {
        type: "microcredits_remaining",
        meterId: event.meterId,
        balanceMicrocredits: event.balanceMicrocredits,
        thresholdMicrocredits: threshold,
      };
    }
    if (
      trigger.type === "microcredits_spent" &&
      spentMicrocredits !== null &&
      spentMicrocredits >= threshold
    ) {
      payload = {
        type: "microcredits_spent",
        meterId: event.meterId,
        spentMicrocredits,
        thresholdMicrocredits: threshold,
      };
    }
    if (payload === null) {
      continue;
    }
    const triggerKey = await firingKey({
      baseTriggerKey: baseTriggerKeyFor({ payload }),
      cycle,
      firingId: event.externalId,
      rule: rule.rule,
      tenantId: event.tenantId,
    });
    if (triggerKey === null) {
      continue;
    }
    await recordFiring({
      firing: {
        rule: rule.rule,
        tenantId: event.tenantId,
        triggerKey,
        payload,
      },
    });
  }
}
