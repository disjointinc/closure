/**
 * garbage-collection/test-suite-resources.test.ts -- seeds a marker-tagged
 * graph plus an unmarked control graph, then asserts collection removes
 * exactly the marked one (pg rows and Redis keys alike).
 *
 * Shares the scratch Postgres + throwaway Redis with the other api tests;
 * see cache/test-helpers.ts for setup requirements. Files run sequentially
 * (api/vitest.config.ts), and the scratch pg persists across runs, so
 * assertions are scoped to fixture ids rather than global counts.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redis } from "../cache/index.ts";
import { keys } from "../cache/keys.ts";
import {
  closeTestState,
  makeAssignment,
  makeCycle,
  makeMeter,
  makePlan,
  makeProductLine,
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
  meterBalances,
  meterEvents,
  meterOverrides,
  meters,
  meterSpends,
  planFeatures,
  planMeters,
  planPrices,
  plans,
  productLines,
  teamMembers,
  tenantLastActivity,
  tenants,
} from "../db/schema.ts";
import {
  collectTestSuiteResources,
  TEST_SUITE_RESOURCE_MARKER,
} from "./test-suite-resources.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

const markedName = (name: string) =>
  `${TEST_SUITE_RESOURCE_MARKER}-quickstart-test: ${name}`;

/** A full quickstart-style graph, marker-tagged unless control. */
async function makeGraph({ marked }: { marked: boolean }) {
  const productLineId = await makeProductLine();
  const meterId = await makeMeter({ productLineId });
  const cycleId = await makeCycle();
  const planId = await makePlan({ productLineId });
  const teamMemberId = await makeTeamMember();
  const tenantId = await makeTenant();
  const assignmentId = await makeAssignment({ planId, tenantId });

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
  await db.insert(meterBalances).values({
    tenantId,
    meterId,
    balanceMicrocredits: 14_000_000,
    updatedAt: Date.now(),
  });
  await db.insert(meterSpends).values({
    tenantId,
    meterId,
    spendMicrocredits: 1_000_000,
    updatedAt: Date.now(),
  });
  await db.insert(tenantLastActivity).values({
    tenantId,
    meterId,
    lastEventAtMicros: Date.now() * 1000,
  });

  const balanceKey = keys.meterBalance({ meterId, tenantId });
  await redis.set(balanceKey, "14000000");
  await redis.sadd(keys.trackedMeterBalances, balanceKey);
  await redis.set(
    keys.meterEventIdempotency({ externalId, meterId, tenantId }),
    "succeeded",
  );

  if (marked) {
    await db
      .update(productLines)
      .set({ name: markedName("Default product line") })
      .where(eq(productLines.productLineId, productLineId));
    await db
      .update(features)
      .set({ name: markedName("CRM") })
      .where(eq(features.featureId, featureId));
    await db
      .update(meters)
      .set({ name: markedName("Seats") })
      .where(eq(meters.meterId, meterId));
    await db
      .update(cycles)
      .set({ name: markedName("Monthly") })
      .where(eq(cycles.cycleId, cycleId));
    await db
      .update(plans)
      .set({ name: markedName("Starter") })
      .where(eq(plans.planId, planId));
    await db
      .update(teamMembers)
      .set({ name: markedName("Colin") })
      .where(eq(teamMembers.teamMemberId, teamMemberId));
    await db
      .update(tenants)
      .set({ externalIds: { [TEST_SUITE_RESOURCE_MARKER]: "1" } })
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
    teamMemberId,
    tenantId,
  };
}

describe("garbage collection", () => {
  it("collects marked resources and leaves unmarked ones alone", async () => {
    const marked = await makeGraph({ marked: true });
    const control = await makeGraph({ marked: false });

    await collectTestSuiteResources();

    /* Every marked row is gone... */
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
      await pgPair({ meterId: marked.meterId, tenantId: marked.tenantId }),
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

    /* ...and its Redis keys with it. */
    expect(
      await redis.exists(
        keys.meterBalance({
          meterId: marked.meterId,
          tenantId: marked.tenantId,
        }),
      ),
    ).toBe(0);
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
    expect(
      await pgPair({ meterId: control.meterId, tenantId: control.tenantId }),
    ).toHaveLength(1);
    expect(
      await redis.exists(
        keys.meterBalance({
          meterId: control.meterId,
          tenantId: control.tenantId,
        }),
      ),
    ).toBe(1);
    expect(await redis.smembers(keys.trackedMeterBalances)).toContain(
      keys.meterBalance({
        meterId: control.meterId,
        tenantId: control.tenantId,
      }),
    );

    /* Keep cross-run state clean: the marked graph is collected by the pass
     * itself; the control graph is removed by hand. */
    await deleteGraph({ graph: control });
    expect(await tenantRow({ tenantId: control.tenantId })).toBeUndefined();
  });
});

const tenantRow = async ({ tenantId }: { tenantId: string }) =>
  (await db.select().from(tenants).where(eq(tenants.tenantId, tenantId)))[0];

const pgPair = async ({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}) =>
  db
    .select()
    .from(meterBalances)
    .where(
      and(
        eq(meterBalances.tenantId, tenantId),
        eq(meterBalances.meterId, meterId),
      ),
    );

/** Remove a makeGraph fixture by hand (the control graph's cleanup path). */
async function deleteGraph({
  graph,
}: {
  graph: Awaited<ReturnType<typeof makeGraph>>;
}) {
  /* makeAssignment mints its own cycle, distinct from graph.cycleId. */
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.assignmentId, graph.assignmentId));
  await db.delete(meterEvents).where(eq(meterEvents.tenantId, graph.tenantId));
  await db
    .delete(meterBalances)
    .where(eq(meterBalances.tenantId, graph.tenantId));
  await db.delete(meterSpends).where(eq(meterSpends.tenantId, graph.tenantId));
  await db
    .delete(tenantLastActivity)
    .where(eq(tenantLastActivity.tenantId, graph.tenantId));
  await db
    .delete(featureOverrides)
    .where(eq(featureOverrides.tenantId, graph.tenantId));
  await db
    .delete(meterOverrides)
    .where(eq(meterOverrides.tenantId, graph.tenantId));
  await db.delete(assignments).where(eq(assignments.tenantId, graph.tenantId));
  await db.delete(tenants).where(eq(tenants.tenantId, graph.tenantId));
  await db.delete(planFeatures).where(eq(planFeatures.planId, graph.planId));
  await db.delete(planMeters).where(eq(planMeters.planId, graph.planId));
  await db.delete(planPrices).where(eq(planPrices.planId, graph.planId));
  await db.delete(plans).where(eq(plans.planId, graph.planId));
  await db
    .delete(featureOptions)
    .where(eq(featureOptions.featureId, graph.featureId));
  await db.delete(features).where(eq(features.featureId, graph.featureId));
  await db.delete(meters).where(eq(meters.meterId, graph.meterId));
  await db.delete(cycles).where(eq(cycles.cycleId, graph.cycleId));
  if (assignment) {
    await db.delete(cycles).where(eq(cycles.cycleId, assignment.cycleId));
  }
  await db
    .delete(teamMembers)
    .where(eq(teamMembers.teamMemberId, graph.teamMemberId));
  await db
    .delete(productLines)
    .where(eq(productLines.productLineId, graph.productLineId));
  await redis.del(
    keys.meterBalance({ meterId: graph.meterId, tenantId: graph.tenantId }),
    keys.meterSpend({ meterId: graph.meterId, tenantId: graph.tenantId }),
    keys.lastActivity({ meterId: graph.meterId, tenantId: graph.tenantId }),
    keys.ruleWatchSet({ meterId: graph.meterId, tenantId: graph.tenantId }),
    keys.meterEventIdempotency({
      externalId: graph.externalId,
      meterId: graph.meterId,
      tenantId: graph.tenantId,
    }),
  );
  await redis.srem(
    keys.trackedMeterBalances,
    keys.meterBalance({ meterId: graph.meterId, tenantId: graph.tenantId }),
  );
}
