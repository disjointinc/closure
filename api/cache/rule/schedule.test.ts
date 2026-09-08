/**
 * cache/rule/schedule.test.ts -- integration tests for the periodic rule
 * scheduler: scope filtering (global / plan / tenant) for the scan-based
 * triggers, which can't rely on the single-tenant event-time context.
 *
 * Shares the scratch Postgres + throwaway Redis with the other cache tests;
 * see test-helpers.ts. Files run sequentially (api/vitest.config.ts).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { redis } from "../../cache/index.ts";
import { keys } from "../../cache/keys.ts";
import { db } from "../../db/index.ts";
import {
  ruleRuns,
  rules,
  taskTypes,
  tenantLastActivity,
} from "../../db/schema.ts";
import type { Rule } from "../../schemas/rule.ts";
import {
  closeTestState,
  makeAssignment,
  makeMeter,
  makePlan,
  makeRule,
  makeTenant,
  newTaskTypeId,
  resetTestState,
} from "../test-helpers.ts";
import { executeDueRuleRuns } from "./execute.ts";
import { evaluateScheduledRules } from "./schedule.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

/* The scratch pg DB accumulates fixtures across runs; the scheduler scans
 * every non-deprecated rule, so leftovers from prior runs make each pass
 * slower quadratically. Deprecate everything before each test to keep a
 * pass proportional to its own fixtures. */
beforeEach(async () => {
  await db.update(rules).set({ deprecatedAt: Date.now() });
});

/**
 * Drain firings after each scheduler pass. rule_runs is a shared queue across
 * the sequentially-run test files; leaving due runs behind starves the
 * executor's CLAIM_BATCH in execute.test.ts.
 */
async function runScheduler(): Promise<void> {
  await evaluateScheduledRules();
  await executeDueRuleRuns();
}

const ONCE: Rule["recurrence"] = {
  window: null,
  rearmOnRecover: false,
  limitRecurrences: 1,
};

async function makeTaskType(): Promise<string> {
  const taskTypeId = newTaskTypeId();
  await db.insert(taskTypes).values({
    taskTypeId,
    createdAt: Date.now(),
    deprecatedAt: null,
    defaultAssigneeTeamMemberId: null,
    integrations: null,
    name: "Scheduler test type",
    description: null,
  });
  return taskTypeId;
}

/**
 * Mark a tenant stale on a meter by feeding the last-activity read model,
 * the way ingest would: the mlast: Redis key plus its durable
 * tenant_last_activity row.
 */
async function makeStaleEvent({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}) {
  const staleMicros = (Date.now() - 10 * 24 * 60 * 60 * 1000) * 1000;
  await redis.set(keys.lastActivity({ meterId, tenantId }), staleMicros);
  await db
    .insert(tenantLastActivity)
    .values({
      meterId,
      tenantId,
      lastEventAtMicros: staleMicros,
    })
    .onConflictDoUpdate({
      target: [tenantLastActivity.tenantId, tenantLastActivity.meterId],
      set: { lastEventAtMicros: staleMicros },
    });
}

async function firedTenantIds({
  ruleId,
}: {
  ruleId: string;
}): Promise<string[]> {
  const rows = await db
    .select({ tenantId: ruleRuns.tenantId })
    .from(ruleRuns)
    .where(eq(ruleRuns.ruleId, ruleId));
  return rows.map((row) => row.tenantId);
}

describe("rule scheduler scope filtering", () => {
  it("fires an inactive_for rule only for tenants in scope", async () => {
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    const planId = await makePlan();
    const tenantInScope = await makeTenant();
    const tenantOutOfScope = await makeTenant();
    // Candidates are tenants with an open assignment; both need one to be
    // eligible for an inactive_for firing.
    await makeAssignment({ planId, tenantId: tenantInScope });
    await makeAssignment({ planId, tenantId: tenantOutOfScope });
    // Both tenants are stale on the meter.
    await makeStaleEvent({ meterId, tenantId: tenantInScope });
    await makeStaleEvent({ meterId, tenantId: tenantOutOfScope });

    const ruleId = await makeRule({
      rule: {
        scope: { kind: "tenant", tenantId: tenantInScope },
        trigger: {
          type: "inactive_for",
          meterId,
          duration: { days: 7, months: null },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Tenant went quiet",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "scoped inactive rule",
        description: null,
      },
    });

    await runScheduler();

    const fired = await firedTenantIds({ ruleId });
    expect(fired).toContain(tenantInScope);
    expect(fired).not.toContain(tenantOutOfScope);
  });

  it("fires a global inactive_for rule for every stale tenant", async () => {
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    const planId = await makePlan();
    const tenantA = await makeTenant();
    const tenantB = await makeTenant();
    await makeAssignment({ planId, tenantId: tenantA });
    await makeAssignment({ planId, tenantId: tenantB });
    await makeStaleEvent({ meterId, tenantId: tenantA });
    await makeStaleEvent({ meterId, tenantId: tenantB });

    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: {
          type: "inactive_for",
          meterId,
          duration: { days: 7, months: null },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Tenant went quiet",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "global inactive rule",
        description: null,
      },
    });

    await runScheduler();

    const fired = await firedTenantIds({ ruleId });
    expect(fired).toContain(tenantA);
    expect(fired).toContain(tenantB);
  });

  it("fires a plan-scoped rule for tenants on any of the planIds", async () => {
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    const planA = await makePlan();
    const planB = await makePlan();
    const planOther = await makePlan();
    const tenantOnA = await makeTenant();
    const tenantOnB = await makeTenant();
    const tenantOnOther = await makeTenant();
    await makeAssignment({ planId: planA, tenantId: tenantOnA });
    await makeAssignment({ planId: planB, tenantId: tenantOnB });
    await makeAssignment({ planId: planOther, tenantId: tenantOnOther });
    // All three tenants are stale on the meter.
    await makeStaleEvent({ meterId, tenantId: tenantOnA });
    await makeStaleEvent({ meterId, tenantId: tenantOnB });
    await makeStaleEvent({ meterId, tenantId: tenantOnOther });

    // Scoped to plans A and B: tenants on either fire; planOther does not.
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "plan", planIds: [planA, planB] },
        trigger: {
          type: "inactive_for",
          meterId,
          duration: { days: 7, months: null },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Tenant went quiet",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "multi-plan inactive rule",
        description: null,
      },
    });

    await runScheduler();

    const fired = await firedTenantIds({ ruleId });
    expect(fired).toContain(tenantOnA);
    expect(fired).toContain(tenantOnB);
    expect(fired).not.toContain(tenantOnOther);
  });

  it("skips tenants whose only assignment is future-dated", async () => {
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    const planId = await makePlan();
    const tenantStarted = await makeTenant();
    const tenantFuture = await makeTenant();
    await makeAssignment({ planId, tenantId: tenantStarted });
    await makeAssignment({
      planId,
      startsAt: Date.now() + 24 * 60 * 60 * 1000,
      tenantId: tenantFuture,
    });
    await makeStaleEvent({ meterId, tenantId: tenantStarted });
    await makeStaleEvent({ meterId, tenantId: tenantFuture });

    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: {
          type: "inactive_for",
          meterId,
          duration: { days: 7, months: null },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Tenant went quiet",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "future-dated assignment rule",
        description: null,
      },
    });

    await runScheduler();

    const fired = await firedTenantIds({ ruleId });
    expect(fired).toContain(tenantStarted);
    expect(fired).not.toContain(tenantFuture);
  });
});
