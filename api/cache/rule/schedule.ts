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
 *     (rule_scheduler_state), so each tick scans only invoices closed since
 *     the last tick instead of the full closed history.
 *   - Per-tenant billing cycles are batched into one query
 *     (getBillingCycles), so a tick does O(1) pg round-trips, not
 *     O(candidates).
 *
 * Firing goes through recordFiring, so idempotency is the (rule, tenant,
 * triggerKey) index: a re-scan re-detects the same condition but inserts
 * nothing new. Trigger keys encode the window/instance so a new billing cycle
 * or inactivity window fires afresh.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  assignments,
  invoices,
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

/**
 * The open-assignment tenants a rule applies to, with each tenant's plan.
 * One indexed query; the scope filter folds into it so there is no separate
 * assignments probe per candidate. Global and tenant scopes don't need the
 * plan map (tenant scope is a single explicit tenant), but fetching it is
 * one row per tenant and keeps the call sites uniform.
 */
async function scopeCandidatePlans({
  rule,
}: {
  rule: Rule;
}): Promise<Map<string, string>> {
  const scope = rule.scope;
  const conditions = [isNull(assignments.endsAt)];
  if (scope.kind === "tenant") {
    conditions.push(eq(assignments.tenantId, scope.tenantId));
  }
  if (scope.kind === "plan") {
    conditions.push(inArray(assignments.planId, scope.planIds));
  }
  const rows = await db
    .select({ tenantId: assignments.tenantId, planId: assignments.planId })
    .from(assignments)
    .where(and(...conditions));
  return new Map(rows.map((row) => [row.tenantId, row.planId]));
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
    const candidates = await scopeCandidatePlans({ rule });
    if (candidates.size === 0) {
      continue;
    }
    const tenantIds = [...candidates.keys()];
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
    /* One query for every stale tenant's billing cycle; the firing key is
     * anchored to the last-seen timestamp so a fresh event opens a new
     * inactivity window. */
    const cyclesByTenant = await getBillingCycles({ tenantIds: staleIds });
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
    // invoice_closed / invoice_due key off invoices; the offset is applied
    // to the lifecycle timestamp. assignment_started / cycle_end follow the
    // same pattern once those lifecycle events are queryable.
    if (relativeTo !== "invoice_closed" && relativeTo !== "invoice_due") {
      continue;
    }
    // High-water mark: only scan invoices closed since the last tick, so the
    // scan stays bounded as the closed-invoice history grows.
    const [stateRow] = await db
      .select()
      .from(ruleSchedulerState)
      .where(eq(ruleSchedulerState.ruleId, rule.ruleId))
      .limit(1);
    const evaluatedThroughMs = stateRow?.evaluatedThroughMs ?? 0;
    const due = await db
      .select()
      .from(invoices)
      .where(
        and(
          isNotNull(invoices.closedAt),
          gt(invoices.closedAt, evaluatedThroughMs),
          lte(invoices.closedAt, threshold),
        ),
      )
      .orderBy(invoices.closedAt);
    if (due.length === 0) {
      continue;
    }
    // Scope-filter in one query against open assignments.
    const candidates = await scopeCandidatePlans({ rule });
    const inScope = due.filter((invoice) => {
      if (rule.scope.kind === "global") {
        return true;
      }
      return candidates.has(invoice.tenantId);
    });
    const cyclesByTenant = await getBillingCycles({
      tenantIds: inScope.map((invoice) => invoice.tenantId),
    });
    let maxClosedAt = evaluatedThroughMs;
    for (const invoice of due) {
      if (invoice.closedAt === null) {
        continue;
      }
      // Advance the watermark over every scanned invoice, even out-of-scope
      // ones, so a tenant leaving a plan doesn't wedge the mark.
      maxClosedAt = Math.max(maxClosedAt, invoice.closedAt);
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
    // Persist the high-water mark so the next tick resumes where this one
    // stopped. Upsert: the rule row appears on its first evaluated invoice.
    await db
      .insert(ruleSchedulerState)
      .values({ ruleId: rule.ruleId, evaluatedThroughMs: maxClosedAt })
      .onConflictDoUpdate({
        target: ruleSchedulerState.ruleId,
        set: { evaluatedThroughMs: maxClosedAt },
      });
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
