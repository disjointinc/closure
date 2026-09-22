/**
 * cache/rule-executor.test.ts -- integration tests for the rule_run executor:
 * a due run executes and is marked succeeded; a failing action retries with
 * backoff and, once exhausted, is marked failed (kept for the audit log).
 *
 * Shares the scratch Postgres + throwaway Redis; see test-helpers.ts. Files
 * run sequentially (api/vitest.config.ts).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/index.ts";
import { ruleRuns, taskTypes, tasks } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import {
  closeTestState,
  makeRule,
  makeTenant,
  newTaskTypeId,
  resetTestState,
} from "../test-helpers.ts";
import { executeDueRuleRuns } from "./execute.ts";

/** Fire once, ever, per trigger instance. */
const ONCE = {
  window: null,
  rearmOnRecover: false,
  limitRecurrences: 1,
} as const;

/** A minimal metering trigger for rules whose executor doesn't read it. */
const TRIGGER = {
  type: "microcredits_spent",
  meterId: "meter_unused",
  at: { absolute: 1 },
} as const;

beforeAll(resetTestState);
afterAll(closeTestState);

async function makeTaskType(): Promise<string> {
  const taskTypeId = newTaskTypeId();
  await db.insert(taskTypes).values({
    taskTypeId,
    createdAt: Date.now(),
    deprecatedAt: null,
    defaultAssigneeTeamMemberId: null,
    integrations: [],
    name: "Executor test type",
    description: null,
  });
  return taskTypeId;
}

/** Insert a due rule_run directly and return its id. */
async function makeDueRun({
  ruleId,
  tenantId,
}: {
  ruleId: string;
  tenantId: string;
}): Promise<string> {
  const ruleRunId = generateId({ prefix: "rule_run" });
  await db.insert(ruleRuns).values({
    ruleRunId,
    createdAt: Date.now(),
    ruleId,
    tenantId,
    triggerKey: "test",
    actionIndex: 0,
    payload: {
      type: "microcredits_spent",
      meterId: "meter_test",
      spentMicrocredits: 1,
      thresholdMicrocredits: 1,
    },
    attempts: 0,
    availableAt: Date.now() - 1,
    succeededAt: null,
    failedAt: null,
    lastError: null,
  });
  return ruleRunId;
}

describe("rule executor", () => {
  it("executes a due create_task run and marks it succeeded", async () => {
    const tenantId = await makeTenant();
    const taskTypeId = await makeTaskType();
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: TRIGGER,
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Hello {{tenantId}}",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "exec rule",
        description: null,
      },
    });
    const ruleRunId = await makeDueRun({ ruleId, tenantId });

    await executeDueRuleRuns();

    const [run] = await db
      .select()
      .from(ruleRuns)
      .where(eq(ruleRuns.ruleRunId, ruleRunId));
    expect(run.succeededAt).not.toBeNull();
    expect(run.failedAt).toBeNull();

    // The task was created with the {{placeholder}} substituted. Single-brace
    // placeholders are left untouched.
    const created = await db
      .select()
      .from(tasks)
      .where(eq(tasks.tenantId, tenantId));
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe(`Hello ${tenantId}`);
    expect(created[0].sourceRuleId).toBe(ruleId);
  });

  it("leaves single-brace placeholders untouched", async () => {
    const tenantId = await makeTenant();
    const taskTypeId = await makeTaskType();
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: TRIGGER,
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "literal {tenantId} braces",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "literal-brace rule",
        description: null,
      },
    });
    await makeDueRun({ ruleId, tenantId });
    await executeDueRuleRuns();
    const created = await db
      .select()
      .from(tasks)
      .where(eq(tasks.tenantId, tenantId));
    expect(created[0].title).toBe("literal {tenantId} braces");
  });

  it("marks a poison run failed after exhausting retries", async () => {
    const tenantId = await makeTenant();
    // add_invoice_item with no open invoice throws; exhaust retries.
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: TRIGGER,
        recurrence: ONCE,
        actions: [
          {
            type: "add_invoice_item",
            fixedAmounts: null,
            percentageOfInvoice: 10,
          },
        ],
        name: "poison rule",
        description: null,
      },
    });
    const ruleRunId = await makeDueRun({ ruleId, tenantId });

    // Run enough times to exceed MAX_ATTEMPTS; force availability each time.
    for (let i = 0; i < 6; i++) {
      await db
        .update(ruleRuns)
        .set({ availableAt: Date.now() - 1 })
        .where(eq(ruleRuns.ruleRunId, ruleRunId));
      await executeDueRuleRuns();
    }

    const [run] = await db
      .select()
      .from(ruleRuns)
      .where(eq(ruleRuns.ruleRunId, ruleRunId));
    expect(run.succeededAt).toBeNull();
    expect(run.failedAt).not.toBeNull();
    expect(run.lastError).not.toBeNull();
    expect(run.attempts).toBeGreaterThanOrEqual(5);
  });
});
