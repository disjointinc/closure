/**
 * cache/test_helpers.ts -- shared fixtures for the cache integration tests.
 * Test files run in parallel against the same Postgres + Redis the app uses.
 * That only works because every file scopes its assertions to its own
 * fixtures (random-suffixed ids, tenant-scoped counts, per-key reads) and
 * never asserts global state (flush counts, stream length, table-wide
 * updates): the flush/checkpoint/reconcile machinery is idempotent, so any
 * worker's pass converges any fixture to the same durable state. Keep that
 * contract when adding tests here.
 *
 * Nothing global is ever wiped. cleanupTestState deletes only what a file
 * created: tenant-scoped rows for its tenants, those tenants' Redis keys,
 * their mbal:tracked memberships, and their entries on the pending stream.
 * Root entities (tenants, meters, plans, rules, ...) stay: they're tiny,
 * never globally scanned, and hard-deleting them mid-run is what races the
 * checkpoint/reconcile machinery into FK violations.
 */
import { randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  assignments,
  billingPeriods,
  creditGrants,
  cycles,
  experiments,
  experimentTreatmentPlans,
  experimentTreatmentTenants,
  experimentTreatments,
  invoices,
  items,
  meterBalances,
  meterEvents,
  meterEventsDlq,
  meters,
  meterSpends,
  planMeters,
  plans,
  productLines,
  ruleBackfills,
  ruleRuns,
  ruleSchedulerState,
  rules,
  tasks,
  taskTypes,
  teamMembers,
  tenantLastActivity,
  tenants,
} from "../db/schema.ts";
import type { Rule } from "../schemas/rule.ts";
import { redis } from "./index.ts";
import { keys } from "./keys.ts";
import {
  type MeterEventPayload,
  PG_FOREIGN_KEY_VIOLATION,
  pgErrorCode,
} from "./meter/index.ts";
import { MICROS_PER_MS } from "./rule/schedule.ts";

export function suffix({ length }: { length: number }): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}

export const newTenantId = () => `tenant_${suffix({ length: 22 })}`;
export const newMeterId = () => `meter_${suffix({ length: 20 })}`;
export const newProductLineId = () => `product_line_${suffix({ length: 20 })}`;
export const newMeterEventId = () => `meter_event_${suffix({ length: 37 })}`;
export const newCreditGrantId = () => `credit_grant_${suffix({ length: 25 })}`;
export const newRuleId = () => `rule_${suffix({ length: 20 })}`;
export const newTaskTypeId = () => `task_type_${suffix({ length: 20 })}`;
export const newCycleId = () => `cycle_${suffix({ length: 20 })}`;
export const newPlanId = () => `plan_${suffix({ length: 20 })}`;
export const newAssignmentId = () => `assignment_${suffix({ length: 24 })}`;

/** Tenant ids created by this file, for cleanupTestState. */
const testTenantIds = new Set<string>();

export async function makeTenant({
  tenantId,
}: { tenantId?: string } = {}): Promise<string> {
  const resolvedTenantId = tenantId ?? newTenantId();
  await db.insert(tenants).values({
    tenantId: resolvedTenantId,
    createdAt: Date.now(),
    deletedAt: null,
    externalIds: {},
  });
  testTenantIds.add(resolvedTenantId);
  return resolvedTenantId;
}

export async function makeProductLine({
  productLineId,
}: { productLineId?: string } = {}): Promise<string> {
  const resolvedProductLineId = productLineId ?? newProductLineId();
  await db.insert(productLines).values({
    productLineId: resolvedProductLineId,
    createdAt: Date.now(),
    deprecatedAt: null,
    forceBillingCycleSynchronizationWithProductLineIds: [],
    name: "Test product line",
    description: null,
  });
  return resolvedProductLineId;
}

export async function makeMeter({
  meterId,
  productLineId,
}: { meterId?: string; productLineId?: string } = {}): Promise<string> {
  const resolvedMeterId = meterId ?? newMeterId();
  await db.insert(meters).values({
    meterId: resolvedMeterId,
    productLineIds: [productLineId ?? (await makeProductLine())],
    createdAt: Date.now(),
    deprecatedAt: null,
    name: "Test meter",
    description: null,
  });
  return resolvedMeterId;
}

/** Attach a meter to a plan (allocation rows the assignment service seeds from). */
export async function makePlanMeter({
  meterId,
  planId,
}: {
  meterId: string;
  planId: string;
}): Promise<void> {
  await db.insert(planMeters).values({
    planId,
    meterId,
    defaultMicrocredits: 1_000_000,
    limitMicrocredits: null,
    reset: null,
    rollovers: null,
    topUpPricesPerCredit: [],
    topUpCreditPackSizes: { static: null, dynamic: null },
  });
}

export async function makeCycle(): Promise<string> {
  const cycleId = newCycleId();
  await db.insert(cycles).values({
    cycleId,
    createdAt: Date.now(),
    deprecatedAt: null,
    defaultDiscountPercentage: null,
    name: "Test cycle",
    description: null,
    charged: "upfront",
    cycleLength: { days: 30, months: null },
    creditPeriod: null,
    gracePeriod: null,
  });
  return cycleId;
}

export async function makePlan({
  productLineId,
}: { productLineId?: string } = {}): Promise<string> {
  const planId = newPlanId();
  await db.insert(plans).values({
    planId,
    productLineId: productLineId ?? (await makeProductLine()),
    derivedFromPlanId: null,
    createdAt: Date.now(),
    deprecatedAt: null,
    name: "Test plan",
    description: null,
  });
  return planId;
}

/** Assign a tenant to a plan on a fresh cycle. Returns the assignmentId. */
export async function makeAssignment({
  createdAt,
  planId,
  startsAt,
  tenantId,
}: {
  /** Defaults to now; pass a past time for an assignment with history. */
  createdAt?: number;
  planId: string;
  /** Defaults to now; pass a future time for a not-yet-open assignment. */
  startsAt?: number;
  tenantId: string;
}): Promise<string> {
  const assignmentId = newAssignmentId();
  const cycleId = await makeCycle();
  const [plan] = await db.select().from(plans).where(eq(plans.planId, planId));
  await db.insert(assignments).values({
    assignmentId,
    tenantId,
    planId,
    productLineId: plan.productLineId,
    experimentId: null,
    cycleId,
    createdAt: createdAt ?? Date.now(),
    startsAt: startsAt ?? Date.now(),
    endsAt: null,
  });
  return assignmentId;
}

export async function makeTeamMember(): Promise<string> {
  const teamMemberId = `team_member_${suffix({ length: 16 })}`;
  await db.insert(teamMembers).values({
    teamMemberId,
    email: `${teamMemberId}@test.invalid`,
    createdAt: Date.now(),
    name: null,
    profilePictureUrl: null,
  });
  return teamMemberId;
}

/** Task type ids created by this file, for cleanupTestState. */
const testTaskTypeIds = new Set<string>();

export async function makeTaskType(): Promise<string> {
  const taskTypeId = newTaskTypeId();
  await db.insert(taskTypes).values({
    taskTypeId,
    createdAt: Date.now(),
    deprecatedAt: null,
    defaultAssigneeTeamMemberId: null,
    integrations: [],
    name: "Test task type",
    description: null,
  });
  testTaskTypeIds.add(taskTypeId);
  return taskTypeId;
}

/** Experiment ids created by this file, for cleanupTestState. */
const testExperimentIds = new Set<string>();

/** Registers an experiment for cleanupTestState; returns it for inline use. */
export function trackExperiment<T extends { experimentId: string }>(
  experiment: T,
): T {
  testExperimentIds.add(experiment.experimentId);
  return experiment;
}

/** Rule ids created by this file, for cleanupTestState. */
const testRuleIds = new Set<string>();

/** Registers a rule made through the service for cleanupTestState; returns
 * it for inline use. */
export function trackRule<T extends { ruleId: string }>(rule: T): T {
  testRuleIds.add(rule.ruleId);
  return rule;
}

/**
 * Insert a rule directly (bypassing the API) for evaluation tests. Pass
 * cursorAtMs to start the rule's scheduler bookmark there, as if the rule
 * had been live since then; otherwise its first scheduler tick starts it
 * where createRule would (see startingCursorAtMicros). backfill defaults to
 * "none"; any other value also writes the backfill row createRule would,
 * so a past createdAt backfills everything before it.
 */
export async function makeRule({
  cursorAtMs,
  rule,
}: {
  cursorAtMs?: number;
  rule: Omit<Rule, "ruleId" | "createdAt" | "deprecatedAt" | "backfill"> &
    Partial<Pick<Rule, "ruleId" | "createdAt" | "deprecatedAt" | "backfill">>;
}): Promise<string> {
  const ruleId = rule.ruleId ?? newRuleId();
  const createdAt = rule.createdAt ?? Date.now();
  const backfill = rule.backfill ?? "none";
  await db.insert(rules).values({
    ruleId,
    createdAt,
    deprecatedAt: rule.deprecatedAt ?? null,
    scope: rule.scope,
    trigger: rule.trigger,
    recurrence: rule.recurrence,
    actions: rule.actions,
    backfill,
    name: rule.name,
    description: rule.description,
  });
  testRuleIds.add(ruleId);
  if (backfill !== "none") {
    await db
      .insert(ruleBackfills)
      .values({ ruleId, createdAt, nextAvailableAt: createdAt });
  }
  if (cursorAtMs !== undefined) {
    await db.insert(ruleSchedulerState).values({
      ruleId,
      cursorAtMicros: cursorAtMs * MICROS_PER_MS,
      cursorId: "",
    });
  }
  return ruleId;
}

export function makeEvent({
  amountMicrocredits,
  meterId,
  overrides,
  tenantId,
}: {
  amountMicrocredits: number;
  meterId: string;
  overrides?: Partial<MeterEventPayload>;
  tenantId: string;
}): MeterEventPayload {
  return {
    meterEventId: newMeterEventId(),
    externalId: `ext-${suffix({ length: 16 })}`,
    createdAt: Date.now(),
    meterId,
    tenantId,
    amountMicrocredits,
    ...overrides,
  };
}

export async function pgEventCount({
  tenantId,
}: {
  tenantId: string;
}): Promise<number> {
  const rows = await db
    .select({ meterEventId: meterEvents.meterEventId })
    .from(meterEvents)
    .where(eq(meterEvents.tenantId, tenantId));
  return rows.length;
}

export async function pgCheckpoint({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}) {
  const [row] = await db
    .select()
    .from(meterBalances)
    .where(
      and(
        eq(meterBalances.tenantId, tenantId),
        eq(meterBalances.meterId, meterId),
      ),
    );
  return row;
}

/** Rule-delete attempts in cleanupTestState, and the pause between them. An
 * executor racing the delete finishes its claimed run within a few
 * EXECUTOR_INTERVAL_MS ticks, so about a second of retries is plenty. */
const CLEANUP_RULE_DELETE_ATTEMPTS = 5;
const CLEANUP_RETRY_MS = 200;

/** Fail fast if pg or Redis isn't reachable. */
export async function resetTestState(): Promise<void> {
  await redis.ping();
  await db.execute(sql`select 1`);
}

/**
 * Delete only what this file created (see the header), then close the
 * connections. Concurrent global scans tolerate the row deletions: every
 * scanner either skips gone rows or re-derives them harmlessly, and tenants
 * are never deleted, so no FK can trip.
 */
export async function cleanupTestState(): Promise<void> {
  const tenantIds = [...testTenantIds];
  const ruleIds = [...testRuleIds];
  const experimentIds = [...testExperimentIds];
  const taskTypeIds = [...testTaskTypeIds];
  if (ruleIds.length > 0) {
    /* A rule's side effects outlive its tenants: a global rule fires for
     * every tenant in the database, so clean up by rule too. Deprecate
     * first to stop new firings, then drain the queue and the tasks, then
     * delete the rules themselves (a firing racing the delete hits the
     * rule_id FK and is skipped by recordFirings). */
    await db
      .update(rules)
      .set({ deprecatedAt: Date.now() })
      .where(inArray(rules.ruleId, ruleIds));
    await db
      .delete(ruleSchedulerState)
      .where(inArray(ruleSchedulerState.ruleId, ruleIds));
    await db
      .delete(ruleBackfills)
      .where(inArray(ruleBackfills.ruleId, ruleIds));
    /* An executor that claimed one of these rules' runs before the queue
     * was drained can still write its task after the tasks delete, so the
     * rules delete can trip the tasks FK: drain again and retry. */
    for (let attempt = 1; attempt <= CLEANUP_RULE_DELETE_ATTEMPTS; attempt++) {
      await db.delete(ruleRuns).where(inArray(ruleRuns.ruleId, ruleIds));
      await db.delete(tasks).where(inArray(tasks.sourceRuleId, ruleIds));
      await db.delete(items).where(inArray(items.sourceRuleId, ruleIds));
      try {
        await db.delete(rules).where(inArray(rules.ruleId, ruleIds));
        break;
      } catch (error) {
        if (
          pgErrorCode({ error }) !== PG_FOREIGN_KEY_VIOLATION ||
          attempt >= CLEANUP_RULE_DELETE_ATTEMPTS
        ) {
          throw error;
        }
        console.warn("test cleanup: a rule's run landed mid-delete; retrying", {
          attempt,
        });
        await new Promise((resolve) => setTimeout(resolve, CLEANUP_RETRY_MS));
      }
    }
  }
  if (tenantIds.length > 0) {
    await db.delete(ruleRuns).where(inArray(ruleRuns.tenantId, tenantIds));
    await db.delete(tasks).where(inArray(tasks.tenantId, tenantIds));
    await db
      .delete(meterEventsDlq)
      .where(inArray(meterEventsDlq.tenantId, tenantIds));
    await db
      .delete(meterEvents)
      .where(inArray(meterEvents.tenantId, tenantIds));
    await db
      .delete(creditGrants)
      .where(inArray(creditGrants.tenantId, tenantIds));
    await db
      .delete(meterBalances)
      .where(inArray(meterBalances.tenantId, tenantIds));
    await db
      .delete(meterSpends)
      .where(inArray(meterSpends.tenantId, tenantIds));
    await db
      .delete(tenantLastActivity)
      .where(inArray(tenantLastActivity.tenantId, tenantIds));
    await db
      .delete(experimentTreatmentTenants)
      .where(inArray(experimentTreatmentTenants.tenantId, tenantIds));
    await db
      .delete(billingPeriods)
      .where(inArray(billingPeriods.tenantId, tenantIds));
    await db
      .delete(assignments)
      .where(inArray(assignments.tenantId, tenantIds));
    await db
      .delete(items)
      .where(
        inArray(
          items.invoiceId,
          db
            .select({ invoiceId: invoices.invoiceId })
            .from(invoices)
            .where(inArray(invoices.tenantId, tenantIds)),
        ),
      );
    await db.delete(invoices).where(inArray(invoices.tenantId, tenantIds));
  }
  if (taskTypeIds.length > 0) {
    await db
      .delete(taskTypes)
      .where(inArray(taskTypes.taskTypeId, taskTypeIds));
  }
  if (experimentIds.length > 0) {
    // FK order: treatment plans/tenants reference treatments; treatments
    // reference experiments; assignments (deleted above) reference
    // experiments.
    await db
      .delete(experimentTreatmentPlans)
      .where(inArray(experimentTreatmentPlans.experimentId, experimentIds));
    await db
      .delete(experimentTreatmentTenants)
      .where(inArray(experimentTreatmentTenants.experimentId, experimentIds));
    await db
      .delete(experimentTreatments)
      .where(inArray(experimentTreatments.experimentId, experimentIds));
    await db
      .delete(experiments)
      .where(inArray(experiments.experimentId, experimentIds));
  }
  for (const tenantId of tenantIds) {
    const tenantKeys = await redis.keys(`*:${tenantId}:*`);
    const balanceKeys = tenantKeys.filter((key) => key.startsWith("mbal:"));
    if (balanceKeys.length > 0) {
      await redis.srem(keys.trackedMeterBalances, ...balanceKeys);
    }
    if (tenantKeys.length > 0) {
      await redis.del(...tenantKeys);
    }
  }
  if (tenantIds.length > 0) {
    const pending = await redis.xrange(keys.pendingMeterEvents, "-", "+");
    const ours = pending
      .filter(([, fields]) =>
        fields.some((field) =>
          tenantIds.some((tenantId) => field.includes(tenantId)),
        ),
      )
      .map(([entryId]) => entryId);
    if (ours.length > 0) {
      await redis.xdel(keys.pendingMeterEvents, ...ours);
    }
  }
  redis.quit();
  await db.$client.end();
}
