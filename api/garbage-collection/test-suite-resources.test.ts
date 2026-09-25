/**
 * garbage-collection/test-suite-resources.test.ts -- seeds a graph tagged
 * with this file's suite marker plus a control graph tagged with a
 * different suite's, then asserts a scoped collection removes exactly this
 * suite's graph (pg rows and Redis keys alike) and leaves the other
 * suite's alone -- the isolation property that lets every suite collect
 * its own resources in parallel.
 *
 * Shares Postgres + Redis with the other integration tests, running in
 * parallel; see cache/test-helpers.ts for the fixture-scoping contract
 * that makes that safe. Assertions are scoped to fixture ids rather than
 * global counts.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redis } from "../cache/index.ts";
import { keys } from "../cache/keys.ts";
import {
  cleanupTestState,
  makeAssignment,
  makeCycle,
  makeMeter,
  makePlan,
  makeProductLine,
  makeRule,
  makeTaskType,
  makeTeamMember,
  makeTenant,
  newMeterEventId,
  resetTestState,
  suffix,
} from "../cache/test-helpers.ts";
import { db } from "../db/index.ts";
import {
  assignments,
  cycles,
  featureOptions,
  featureOverrides,
  features,
  meterEvents,
  meterOverrides,
  meters,
  planFeatures,
  planMeters,
  planPrices,
  plans,
  productLines,
  ruleRuns,
  tasks,
  teamMembers,
  tenants,
} from "../db/schema.ts";
import {
  collectTestSuiteResources,
  createMarkedResource,
  TEST_SUITE_RESOURCE_MARKER,
} from "./test-suite-resources.ts";

beforeAll(resetTestState);
afterAll(cleanupTestState);

/** A full quickstart-style graph, tagged with the given suite marker (or
 * left unmarked when null).
 *
 * These test fixtures deliberately don't include metering state (no
 * meter_balances/meter_spends/tenant_last_activity rows, no Redis balance
 * keys). If they did, the checkpoint and reconciler loops would try to
 * write that state for a tenant that's being hard-deleted by the
 * collection. That write would fail the tenant FK, because the tenant row
 * is gone. The fixtures still include enough Redis state (an event row,
 * an idempotency marker, tracked-set membership) to prove the collect
 * cleans up Redis.
 */
async function makeGraph({ markedAs }: { markedAs: string | null }) {
  const productLineId = await makeProductLine();
  const meterId = await makeMeter({ productLineId });
  const cycleId = await makeCycle();
  const planId = await makePlan({ productLineId });
  const teamMemberId = await makeTeamMember();
  const tenantId = await makeTenant();
  const assignmentId = await makeAssignment({ planId, tenantId });
  /* Ended, so the rule scheduler never picks this tenant as a candidate:
   * collection hard-deletes the graph, and a scheduler pass firing a rule
   * for a tenant mid-deletion violates the rule_runs tenant FK. */
  await db
    .update(assignments)
    .set({ endsAt: Date.now() })
    .where(eq(assignments.assignmentId, assignmentId));

  const featureId = `feature_${suffix({ length: 20 })}`;
  await db.insert(features).values({
    featureId,
    productLineId,
    createdAt: Date.now(),
    deprecatedAt: null,
    name: "Test feature",
    description: null,
  });
  const featureOptionId = `feature_option_${suffix({ length: 20 })}`;
  await db.insert(featureOptions).values({
    featureOptionId,
    featureId,
    name: "hubspot",
    description: null,
  });
  await db.insert(planPrices).values({
    planId,
    cycleId,
    amounts: [{ currency: "USD", unit: "cents", value: 2900 }],
  });
  await db.insert(planFeatures).values({ planId, featureId, setTo: false });
  await db.insert(planMeters).values({
    planId,
    meterId,
    defaultMicrocredits: 10_000_000,
    limitMicrocredits: 30_000_000,
    reset: "billing_cycle_end",
    rollovers: 1,
    topUpPricesPerCredit: [
      {
        startingAtPackSizeMicrocredits: 0,
        prices: [
          {
            cycleId,
            amounts: [{ currency: "USD", unit: "cents", value: 500 }],
          },
        ],
      },
    ],
    topUpCreditPackSizes: { static: [1_000_000], dynamic: null },
  });

  const featureOverrideId = `feature_override_${suffix({ length: 24 })}`;
  await db.insert(featureOverrides).values({
    featureOverrideId,
    tenantId,
    featureId,
    setTo: ["hubspot"],
    createdAt: Date.now(),
    byTeamMemberId: teamMemberId,
    reason: null,
  });
  const meterOverrideId = `meter_override_${suffix({ length: 24 })}`;
  await db.insert(meterOverrides).values({
    meterOverrideId,
    tenantId,
    meterId,
    defaultMicrocredits: 15_000_000,
    limitMicrocredits: 30_000_000,
    reset: "billing_cycle_end",
    rollovers: 1,
    topUpPricesPerCredit: [],
    topUpCreditPackSizes: { static: [1_000_000], dynamic: null },
    createdAt: Date.now(),
    byTeamMemberId: teamMemberId,
    reason: null,
  });

  const externalId = `ext-${suffix({ length: 16 })}`;
  const meterEventId = newMeterEventId();
  await db.insert(meterEvents).values({
    meterEventId,
    externalId,
    createdAt: Date.now(),
    receivedAtMicros: null,
    meterId,
    tenantId,
    amountMicrocredits: 1_000_000,
    status: "succeeded",
  });
  /* Tracked-set membership is added by the test body, not here; it carries
   * no balance value, so concurrent checkpoint passes skip it. */
  await redis.set(
    keys.meterEventIdempotency({ externalId, meterId, tenantId }),
    "succeeded",
  );

  /* Rule activity: collection must delete a marked tenant's rule_runs and
   * tasks (FK to tenants) or the tenant delete violates the constraint. The
   * rule_run is future-dated so the executor never claims it mid-test. */
  const taskTypeId = await makeTaskType();
  const ruleId = await makeRule({
    rule: {
      scope: { kind: "global" },
      trigger: { type: "microcredits_spent", meterId, at: { absolute: 1 } },
      recurrence: { window: null, rearmOnRecover: false, limitRecurrences: 1 },
      actions: [
        {
          type: "create_task",
          taskTypeId,
          title: "fixture",
          description: null,
          assignToTeamMemberId: null,
        },
      ],
      name: "GC test rule",
      description: null,
    },
  });
  await db.insert(ruleRuns).values({
    ruleRunId: `rule_run_${suffix({ length: 27 })}`,
    createdAt: Date.now(),
    ruleId,
    tenantId,
    triggerKey: "gc-test",
    actionIndex: 0,
    payload: {
      type: "microcredits_spent",
      meterId,
      spentMicrocredits: 1,
      thresholdMicrocredits: 1,
    },
    attempts: 0,
    availableAt: Date.now() + 3_600_000,
    succeededAt: null,
    failedAt: null,
    lastError: null,
  });
  await db.insert(tasks).values({
    taskId: `task_${suffix({ length: 25 })}`,
    createdAt: Date.now(),
    deletedAt: null,
    taskTypeId,
    tenantId,
    sourceRuleId: ruleId,
    title: "GC test task",
    description: null,
    assignedToTeamMemberId: null,
    completedAt: null,
    externalRefs: [],
  });

  if (markedAs !== null) {
    await db
      .update(productLines)
      .set({
        name: createMarkedResource({
          name: "Default product line",
          suite: markedAs,
        }),
      })
      .where(eq(productLines.productLineId, productLineId));
    await db
      .update(features)
      .set({
        name: createMarkedResource({
          name: "CRM",
          suite: markedAs,
        }),
      })
      .where(eq(features.featureId, featureId));
    await db
      .update(meters)
      .set({
        name: createMarkedResource({
          name: "Seats",
          suite: markedAs,
        }),
      })
      .where(eq(meters.meterId, meterId));
    await db
      .update(cycles)
      .set({
        name: createMarkedResource({
          name: "Monthly",
          suite: markedAs,
        }),
      })
      .where(eq(cycles.cycleId, cycleId));
    await db
      .update(plans)
      .set({
        name: createMarkedResource({
          name: "Starter",
          suite: markedAs,
        }),
      })
      .where(eq(plans.planId, planId));
    await db
      .update(teamMembers)
      .set({
        name: createMarkedResource({
          name: "Colin",
          suite: markedAs,
        }),
      })
      .where(eq(teamMembers.teamMemberId, teamMemberId));
    await db
      .update(tenants)
      .set({ externalIds: { [TEST_SUITE_RESOURCE_MARKER]: markedAs } })
      .where(eq(tenants.tenantId, tenantId));
  }

  return {
    assignmentId,
    cycleId,
    externalId,
    featureId,
    featureOptionId,
    featureOverrideId,
    meterEventId,
    meterId,
    meterOverrideId,
    planId,
    productLineId,
    ruleId,
    taskTypeId,
    teamMemberId,
    tenantId,
  };
}

describe("garbage collection", () => {
  it("collects its own suite's resources and leaves other suites' alone", async () => {
    const marked = await makeGraph({
      markedAs: "test-suite-resources-test-suite",
    });
    /* The control graph carries a different suite's marker: the scoped pass
     * must leave it entirely alone -- that is the isolation property that
     * lets every suite collect its own resources in parallel. */
    const control = await makeGraph({ markedAs: "other-suite" });

    /* The marked tracked-set membership exists only for the duration of the
     * collection pass: a concurrent checkpoint pass would otherwise pick the
     * key up and upsert a meter_balances row for a tenant mid-deletion.
     * (The pass would still see the key here, but with no balance value and
     * no checkpoint rows -- see makeGraph -- there is nothing to upsert.) */
    await redis.sadd(
      keys.trackedMeterBalances,
      keys.meterBalance({ meterId: marked.meterId, tenantId: marked.tenantId }),
    );
    await redis.sadd(
      keys.trackedMeterBalances,
      keys.meterBalance({
        meterId: control.meterId,
        tenantId: control.tenantId,
      }),
    );

    // Scoped to this suite: the pass can't touch any other suite's
    // resources, in-flight or not.
    await collectTestSuiteResources({
      suite: "test-suite-resources-test-suite",
    });

    /* Every marked row is gone */
    expect(await tenantRow({ tenantId: marked.tenantId })).toBeUndefined();
    expect(
      await db
        .select()
        .from(assignments)
        .where(eq(assignments.assignmentId, marked.assignmentId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(featureOverrides)
        .where(
          eq(featureOverrides.featureOverrideId, marked.featureOverrideId),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(meterOverrides)
        .where(eq(meterOverrides.meterOverrideId, marked.meterOverrideId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(meterEvents)
        .where(eq(meterEvents.meterEventId, marked.meterEventId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(ruleRuns)
        .where(eq(ruleRuns.ruleId, marked.ruleId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(tasks)
        .where(eq(tasks.taskTypeId, marked.taskTypeId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(plans).where(eq(plans.planId, marked.planId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(planPrices)
        .where(eq(planPrices.planId, marked.planId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(planFeatures)
        .where(eq(planFeatures.planId, marked.planId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(planMeters)
        .where(eq(planMeters.planId, marked.planId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(features)
        .where(eq(features.featureId, marked.featureId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(featureOptions)
        .where(eq(featureOptions.featureOptionId, marked.featureOptionId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(meters).where(eq(meters.meterId, marked.meterId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(cycles).where(eq(cycles.cycleId, marked.cycleId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamMemberId, marked.teamMemberId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(productLines)
        .where(eq(productLines.productLineId, marked.productLineId)),
    ).toHaveLength(0);

    /* Redis keys are gone too. (No meter_balance assertion here. The
     * marked graph has no balance value by design; see makeGraph.) */
    expect(
      await redis.exists(
        keys.meterEventIdempotency({
          externalId: marked.externalId,
          meterId: marked.meterId,
          tenantId: marked.tenantId,
        }),
      ),
    ).toBe(0);
    expect(await redis.smembers(keys.trackedMeterBalances)).not.toContain(
      keys.meterBalance({ meterId: marked.meterId, tenantId: marked.tenantId }),
    );

    /* The control graph is untouched, pg and Redis alike. */
    expect(await tenantRow({ tenantId: control.tenantId })).toBeDefined();
    expect(
      await db.select().from(plans).where(eq(plans.planId, control.planId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(features)
        .where(eq(features.featureId, control.featureId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(cycles).where(eq(cycles.cycleId, control.cycleId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamMemberId, control.teamMemberId)),
    ).toHaveLength(1);
    /* Scoped to the fixture's own ids: other rules may legitimately fire
     * for the control tenant on a shared database. */
    expect(
      await db
        .select()
        .from(ruleRuns)
        .where(eq(ruleRuns.ruleId, control.ruleId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(tasks)
        .where(eq(tasks.taskTypeId, control.taskTypeId)),
    ).toHaveLength(1);
    /* (No meter_balance row or balance value for the control graph either:
     * see makeGraph. Its tracked-set membership is what must survive.) */
    expect(await redis.smembers(keys.trackedMeterBalances)).toContain(
      keys.meterBalance({
        meterId: control.meterId,
        tenantId: control.tenantId,
      }),
    );

    /* cleanupTestState (afterAll) removes the control graph's tenant-scoped
     * rows and Redis keys; the marked graph is collected by the pass
     * itself. */
  });
});

const tenantRow = async ({ tenantId }: { tenantId: string }) =>
  (await db.select().from(tenants).where(eq(tenants.tenantId, tenantId)))[0];
