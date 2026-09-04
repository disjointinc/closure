/**
 * cache/rule/evaluate.test.ts -- integration tests for event-time rule
 * evaluation: microcredits_remaining / microcredits_spent crossing detection,
 * recurrence windows and quotas, rearm-on-recover, scope additivity, and
 * durable rule_runs writes.
 *
 * Shares the scratch Postgres + throwaway Redis with the other cache tests;
 * see test-helpers.ts. Files run sequentially (api/vitest.config.ts).
 *
 * microcredits_spent reads cumulative spend from pg, so tests flush the
 * buffered events to pg between steps (flushPendingMeterEvents).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  makeEvent,
  makeMeter,
  makeRule,
  makeTenant,
  newTaskTypeId,
  closeTestState,
  resetTestState,
} from "../test-helpers.ts";
import {
  flushPendingMeterEvents,
  recordMeterEvent,
  setMeterBalance,
} from "../meter/index.ts";
import { db } from "../../db/index.ts";
import { ruleRuns, taskTypes } from "../../db/schema.ts";
import type { Rule } from "../../schemas/rule.ts";
import { evaluateMeterEventRules } from "./evaluate.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

/** Fire once, ever, per window. */
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
    name: "Test task type",
    description: null,
  });
  return taskTypeId;
}

async function ruleRunCount({
  ruleId,
  tenantId,
}: {
  ruleId: string;
  tenantId: string;
}): Promise<number> {
  const rows = await db
    .select()
    .from(ruleRuns)
    .where(and(eq(ruleRuns.ruleId, ruleId), eq(ruleRuns.tenantId, tenantId)));
  return rows.length;
}

/** Record a charge, then evaluate rules against the post-decision balance. */
async function charge({
  amountMicrocredits,
  meterId,
  tenantId,
}: {
  amountMicrocredits: number;
  meterId: string;
  tenantId: string;
}) {
  const event = makeEvent({ amountMicrocredits, meterId, tenantId });
  const recorded = await recordMeterEvent({ event });
  await evaluateMeterEventRules({
    event: {
      amountMicrocredits,
      balanceMicrocredits: recorded.balanceMicrocredits,
      externalId: event.externalId ?? event.meterEventId,
      meterId,
      status: recorded.status,
      tenantId,
    },
  });
}

/** Refund (negative amount): always succeeds; reduces cumulative spend. */
async function refund({
  amountMicrocredits,
  meterId,
  tenantId,
}: {
  amountMicrocredits: number;
  meterId: string;
  tenantId: string;
}) {
  const event = makeEvent({
    amountMicrocredits: -amountMicrocredits,
    meterId,
    tenantId,
  });
  const recorded = await recordMeterEvent({ event });
  await evaluateMeterEventRules({
    event: {
      amountMicrocredits: -amountMicrocredits,
      balanceMicrocredits: recorded.balanceMicrocredits,
      externalId: event.externalId ?? event.meterEventId,
      meterId,
      status: recorded.status,
      tenantId,
    },
  });
}

describe("event-time rule evaluation", () => {
  it("fires a microcredits_remaining rule once when the balance crosses", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    // Fire when the balance drops to <= 400_000 (i.e. 600_000 consumed).
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: {
          type: "microcredits_remaining",
          meterId,
          at: { absolute: 400_000 },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Usage threshold hit",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "remaining rule",
        description: null,
      },
    });

    // Above the threshold: no firing.
    await charge({ amountMicrocredits: 300_000, meterId, tenantId });
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(0);

    // Cross the threshold (700_000 -> 200_000): fires.
    await charge({ amountMicrocredits: 500_000, meterId, tenantId });
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);

    // Already below: re-crossing within the same window does not fire again.
    await charge({ amountMicrocredits: 50_000, meterId, tenantId });
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);
  });

  it("fires a microcredits_spent rule when cumulative spend crosses", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    // Fire when cumulative spend this cycle reaches 500_000. Spend is read
    // from pg, so flush each buffered event before the next charge.
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: {
          type: "microcredits_spent",
          meterId,
          at: { absolute: 500_000 },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Spent {{spentMicrocredits}}",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "spent rule",
        description: null,
      },
    });

    await charge({ amountMicrocredits: 300_000, meterId, tenantId });
    await flushPendingMeterEvents();
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(0);

    await charge({ amountMicrocredits: 300_000, meterId, tenantId });
    await flushPendingMeterEvents();
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);
  });

  it("a refund reduces cumulative spend; re-crossing re-fires with rearmOnRecover", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    // Fire when cumulative spend (net of refunds) reaches 500_000; rearm on
    // recovery so a refund below and a re-cross fires again.
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: {
          type: "microcredits_spent",
          meterId,
          at: { absolute: 500_000 },
        },
        recurrence: {
          window: null,
          rearmOnRecover: true,
          limitRecurrences: null,
        },
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Spend threshold",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "spent refund rule",
        description: null,
      },
    });

    // Cross the threshold: fires once.
    await charge({ amountMicrocredits: 600_000, meterId, tenantId });
    await flushPendingMeterEvents();
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);

    // Refund brings spend below the threshold; a follow-up refund does not
    // re-fire (edge only re-arms on recovery below the threshold).
    await refund({ amountMicrocredits: 200_000, meterId, tenantId });
    await flushPendingMeterEvents();
    await refund({ amountMicrocredits: 50_000, meterId, tenantId });
    await flushPendingMeterEvents();
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);

    // Re-cross the threshold with a debit: fires again (net-of-refunds spend
    // is 600 - 200 - 50 + 500 = 850 >= 500).
    await charge({ amountMicrocredits: 500_000, meterId, tenantId });
    await flushPendingMeterEvents();
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(2);
  });

  it("microcredits_spent uses edge detection: no re-fire when already over threshold", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    // Fire when spend crosses 500_000; not a rearm rule, so it should fire
    // once on the crossing and not again on later events above the threshold.
    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: {
          type: "microcredits_spent",
          meterId,
          at: { absolute: 500_000 },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Spend edge",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "spent edge rule",
        description: null,
      },
    });

    // Cross the threshold: fires once.
    await charge({ amountMicrocredits: 600_000, meterId, tenantId });
    await flushPendingMeterEvents();
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);

    // More spend events above the threshold: no re-fire, even though >= is true.
    await charge({ amountMicrocredits: 100_000, meterId, tenantId });
    await flushPendingMeterEvents();
    await charge({ amountMicrocredits: 50_000, meterId, tenantId });
    await flushPendingMeterEvents();
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);
  });

  it("re-fires a rolling-window rule only after the window elapses", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    const ruleId = await makeRule({
      rule: {
        scope: { kind: "global" },
        trigger: {
          type: "microcredits_remaining",
          meterId,
          at: { absolute: 400_000 },
        },
        // At most one firing per rolling day; a fresh crossing re-fires once
        // the window has rolled past the prior firing.
        recurrence: {
          window: { days: 1, months: null },
          rearmOnRecover: true,
          limitRecurrences: 1,
        },
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Rolling window threshold",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "rolling rule",
        description: null,
      },
    });

    // First crossing fires.
    await charge({ amountMicrocredits: 700_000, meterId, tenantId });
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);

    // Recover above the threshold and re-cross within the window: suppressed.
    await refund({ amountMicrocredits: 700_000, meterId, tenantId });
    await charge({ amountMicrocredits: 700_000, meterId, tenantId });
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(1);

    // Backdate the firing past the window, re-cross: fires again.
    await db
      .update(ruleRuns)
      .set({ createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })
      .where(and(eq(ruleRuns.ruleId, ruleId), eq(ruleRuns.tenantId, tenantId)));
    await refund({ amountMicrocredits: 700_000, meterId, tenantId });
    await charge({ amountMicrocredits: 700_000, meterId, tenantId });
    expect(await ruleRunCount({ ruleId, tenantId })).toBe(2);
  });

  it("does not fire microcredits_remaining rules for another tenant", async () => {
    const tenantA = await makeTenant();
    const tenantB = await makeTenant();
    const meterId = await makeMeter();
    const taskTypeId = await makeTaskType();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId: tenantA,
    });
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId: tenantB,
    });

    const ruleId = await makeRule({
      rule: {
        scope: { kind: "tenant", tenantId: tenantA },
        trigger: {
          type: "microcredits_remaining",
          meterId,
          at: { absolute: 400_000 },
        },
        recurrence: ONCE,
        actions: [
          {
            type: "create_task",
            taskTypeId,
            title: "Tenant A threshold",
            description: null,
            assignToTeamMemberId: null,
          },
        ],
        name: "scoped rule",
        description: null,
      },
    });

    // Tenant B crosses the same threshold; the tenant-A-scoped rule must not fire.
    await charge({ amountMicrocredits: 700_000, meterId, tenantId: tenantB });
    expect(await ruleRunCount({ ruleId, tenantId: tenantB })).toBe(0);
  });
});
