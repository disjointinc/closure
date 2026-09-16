/**
 * cache/rule/schedule.ts -- periodic evaluation of inactive_for and
 * relative_to_lifecycle_event rules (the triggers that can't be evaluated in
 * the meter-event hot path).
 *
 * Both paths are built to survive millions of tenants:
 *
 *   - inactive_for never touches meter_events. Candidates are tenants with
 *     an open assignment in scope (one indexed query), and staleness comes
 *     from the tenant_last_activity read model -- a single MGET plus one
 *     pg fallback query for cache misses. Cost scales with subscriptions,
 *     not with the event history, and windows are unbounded.
 *   - relative_to_lifecycle_event keeps a per-rule high-water mark
 *     (rule_scheduler_state, committed per chunk), so each tick scans only
 *     invoices finalized since the last tick, in bounded keyset-paged chunks,
 *     instead of the full finalized history.
 *   - Per-tenant billing cycles are batched into one query
 *     (getBillingCycles), so a tick does O(1) pg round-trips, not
 *     O(candidates).
 *
 * Firing goes through recordFiring, so idempotency is the (rule, tenant,
 * triggerKey) index: a re-scan re-detects the same condition but inserts
 * nothing new. Trigger keys encode the window/instance so a new billing cycle
 * or inactivity window fires afresh.
 */
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  assignments,
  invoices,
  meters,
  plans,
  rules,
  ruleSchedulerState,
} from "../../db/schema.ts";
import type { Rule } from "../../schemas/rule.ts";
import { getLastActivities } from "../meter/index.ts";
import {
  durationToMs,
  firingKey,
  getBillingCycles,
  recordFiring,
} from "./evaluate.ts";

/*
 * Lifecycle chunking: one factor in converting finalize-throughput bursts and
 * outage backlogs into a drain-rate question. Steady-state ticks see at
 * most one chunk; the max bounds how much work one tick monopolizes before
 * deferring the remainder to the next tick (the watermark guarantees it is
 * not lost).
 */
const LIFECYCLE_CHUNK_SIZE = 1_000;
const MAX_CHUNKS_PER_TICK = 10;

/**
 * The open-assignment tenants a rule applies to. One indexed query; the
 * scope filter folds into it so there is no separate assignments probe per
 * candidate. A tenant with several open assignments is one candidate.
 */
async function scopeCandidateTenants({
  rule,
}: {
  rule: Rule;
}): Promise<Set<string>> {
  const scope = rule.scope;
  const conditions = [
    isNull(assignments.endsAt),
    lte(assignments.startsAt, Date.now()),
  ];
  if (scope.kind === "tenant") {
    conditions.push(eq(assignments.tenantId, scope.tenantId));
  }
  if (scope.kind === "plan") {
    conditions.push(inArray(assignments.planId, scope.planIds));
  }
  const rows = await db
    .select({ tenantId: assignments.tenantId })
    .from(assignments)
    .where(and(...conditions));
  return new Set(rows.map((row) => row.tenantId));
}

/** Fire inactive_for rules: no meter event within the inactivity duration. */
async function evaluateInactive(): Promise<void> {
  const inactiveRules = await db
    .select()
    .from(rules)
    .where(
      and(
        isNull(rules.deprecatedAt),
        sql`${rules.trigger} ->> 'type' = 'inactive_for'`,
      ),
    );
  for (const rule of inactiveRules) {
    if (rule.trigger.type !== "inactive_for") {
      continue;
    }
    const { meterId, duration } = rule.trigger;
    const windowMs = durationToMs(duration);
    /* The window is unbounded by design: staleness is checked against the
     * tenant_last_activity read model (an O(1) per-candidate lookup), never
     * by scanning meter_events, so a year-long window costs the same as a
     * day-long one. */
    /* Candidates are tenants with an open assignment in scope: one indexed
     * query that scales with open subscriptions, not the event history. */
    const candidates = await scopeCandidateTenants({ rule });
    if (candidates.size === 0) {
      continue;
    }
    const tenantIds = [...candidates];
    const cutoffMicros = (Date.now() - windowMs) * 1000;
    /* Staleness from the last-activity read model: one MGET plus a single
     * tenant_last_activity query for the misses, so a tick does O(1) round
     * trips per rule, not per candidate. Tenants with no recorded activity
     * (row absent) are stale by definition. */
    const activityByTenant = await getLastActivities({ meterId, tenantIds });
    const staleIds = tenantIds.filter((tenantId) => {
      const lastAt = activityByTenant.get(tenantId) ?? null;
      return lastAt === null || lastAt < cutoffMicros;
    });
    if (staleIds.length === 0) {
      continue;
    }
    /* One query for every stale tenant's billing cycle in the meter's
     * product line; the firing key is anchored to the last-seen timestamp so
     * a fresh event opens a new inactivity window. */
    const [meterRow] = await db
      .select()
      .from(meters)
      .where(eq(meters.meterId, meterId))
      .limit(1);
    if (!meterRow) {
      continue;
    }
    const cyclesByTenant = await getBillingCycles({
      productLineIds: meterRow.productLineIds,
      tenantIds: staleIds,
    });
    for (const tenantId of staleIds) {
      const lastAt = activityByTenant.get(tenantId) ?? 0;
      const triggerKey = await firingKey({
        baseTriggerKey: "inactive_for",
        cycle: cyclesByTenant.get(tenantId) ?? null,
        firingId: `${lastAt}`,
        rule,
        tenantId,
      });
      if (triggerKey === null) {
        continue;
      }
      await recordFiring({
        firing: {
          rule,
          tenantId,
          triggerKey,
          payload: { type: "inactive_for", meterId },
        },
      });
    }
  }
}

/** Fire relative_to_lifecycle_event rules whose lifecycle event + offset has passed. */
async function evaluateLifecycle(): Promise<void> {
  const timeRules = await db
    .select()
    .from(rules)
    .where(
      and(
        isNull(rules.deprecatedAt),
        sql`${rules.trigger} ->> 'type' = 'relative_to_lifecycle_event'`,
      ),
    );
  for (const rule of timeRules) {
    if (rule.trigger.type !== "relative_to_lifecycle_event") {
      continue;
    }
    const { relativeTo, offset } = rule.trigger;
    const offsetMs = durationToMs(offset);
    const threshold = Date.now() - offsetMs;
    // invoice_finalized / invoice_due key off invoices; the offset is applied
    // to the lifecycle timestamp. assignment_started / cycle_end follow the
    // same pattern once those lifecycle events are queryable.
    if (relativeTo !== "invoice_finalized" && relativeTo !== "invoice_due") {
      continue;
    }
    /* High-water mark: only scan invoices finalized since the last tick, in
     * fixed-size chunks paged by a (finalizedAt, invoiceId) keyset cursor --
     * the partial invoices_finalized index serves the range scan, and the
     * composite cursor makes same-millisecond finalizes paginate correctly
     * (a bare finalized_at cursor would skip or repeat them at chunk
     * boundaries). The mark is committed per chunk, so a crash resumes at
     * the last committed chunk rather than re-scanning the whole delta,
     * and a tick processes at most MAX_CHUNKS_PER_TICK, converting bursts
     * and outage backlogs into a drain-rate question. */
    const [stateRow] = await db
      .select()
      .from(ruleSchedulerState)
      .where(eq(ruleSchedulerState.ruleId, rule.ruleId))
      .limit(1);
    let cursorAt = stateRow?.evaluatedThroughMs ?? 0;
    let cursorId = "";
    /* Scope lookup once per rule. Global rules skip it entirely: the open-
     * assignment set would be loaded and then ignored for every chunk. */
    const candidates =
      rule.scope.kind === "global"
        ? null
        : await scopeCandidateTenants({ rule });
    /* A billing_cycle_end window counts firings per billing period, so it
     * needs each candidate's current period boundary ("anchor"). Period
     * boundaries exist only per product line -- a tenant holds at most one
     * open assignment per line -- and two upstream checks pin this rule to
     * one line: createRule rejects cycle-windowed lifecycle rules whose
     * scope plans span lines, and scopeCandidateTenants surfaced exactly
     * the tenants with an open assignment on those plans. So every
     * candidate has an open assignment in the anchor line, and this one
     * lookup covers them all. Rules with rolling/permanent windows never
     * read the cycle. */
    let anchorProductLineId: string | null = null;
    if (rule.scope.kind === "plan") {
      const planRows = await db
        .select()
        .from(plans)
        .where(inArray(plans.planId, rule.scope.planIds));
      const lines = new Set(planRows.map((plan) => plan.productLineId));
      anchorProductLineId = lines.size === 1 ? [...lines][0] : null;
    }
    for (let chunk = 0; chunk < MAX_CHUNKS_PER_TICK; chunk++) {
      const due = await db
        .select()
        .from(invoices)
        .where(
          and(
            isNotNull(invoices.finalizedAt),
            or(
              gt(invoices.finalizedAt, cursorAt),
              and(
                eq(invoices.finalizedAt, cursorAt),
                gt(invoices.invoiceId, cursorId),
              ),
            ),
            lte(invoices.finalizedAt, threshold),
          ),
        )
        .orderBy(asc(invoices.finalizedAt), asc(invoices.invoiceId))
        .limit(LIFECYCLE_CHUNK_SIZE);
      if (due.length === 0) {
        break;
      }
      const inScope = due.filter((invoice) => {
        if (candidates === null) {
          return true;
        }
        return candidates.has(invoice.tenantId);
      });
      const cyclesByTenant = anchorProductLineId
        ? await getBillingCycles({
            productLineIds: [anchorProductLineId],
            tenantIds: inScope.map((invoice) => invoice.tenantId),
          })
        : new Map();
      for (const invoice of due) {
        if (invoice.finalizedAt === null) {
          continue;
        }
        /* Advance the mark over every scanned invoice, even out-of-scope
         * ones, so a tenant leaving a plan doesn't wedge it. */
        cursorAt = Math.max(cursorAt, invoice.finalizedAt);
        cursorId = invoice.invoiceId;
        if (!inScope.includes(invoice)) {
          continue;
        }
        const tenantId = invoice.tenantId;
        const triggerKey = await firingKey({
          baseTriggerKey: `${relativeTo}:${invoice.invoiceId}`,
          cycle: cyclesByTenant.get(tenantId) ?? null,
          firingId: invoice.invoiceId,
          rule,
          tenantId,
        });
        if (triggerKey === null) {
          continue;
        }
        await recordFiring({
          firing: {
            rule,
            tenantId,
            triggerKey,
            payload: {
              type: "relative_to_lifecycle_event",
              invoiceId: invoice.invoiceId,
            },
          },
        });
      }
      /* Commit the mark per chunk, so resume starts at the last processed
       * chunk rather than the start of the delta. Boundary rows at the same
       * finalizedAt re-scan on crash; the idempotency index dedupes them. */
      await db
        .insert(ruleSchedulerState)
        .values({ ruleId: rule.ruleId, evaluatedThroughMs: cursorAt })
        .onConflictDoUpdate({
          target: ruleSchedulerState.ruleId,
          set: { evaluatedThroughMs: cursorAt },
        });
      if (due.length < LIFECYCLE_CHUNK_SIZE) {
        break;
      }
    }
  }
}

/** Run one scheduler pass. */
export async function evaluateScheduledRules(): Promise<void> {
  await evaluateInactive();
  await evaluateLifecycle();
}

const SCHEDULER_INTERVAL_MS = 60 * 1000;

/**
 * Start the scheduler loop. Interval is unref'd and errors are logged, never
 * thrown -- a failed pass just defers to the next one.
 */
export function startRuleSchedulerLoop(): void {
  const scheduler = setInterval(() => {
    evaluateScheduledRules().catch((error) =>
      console.error("rule scheduler pass failed", error),
    );
  }, SCHEDULER_INTERVAL_MS);
  scheduler.unref();
}
