/**
 * v0/experiment/experiment.test.ts -- integration tests for server-side
 * enrollment (create assigns tenants to their treatment plans) and the
 * conclusion roll (tenants land on the concluding plans, with their whole
 * billing-cycle-synchronized group re-anchored).
 *
 * Shares the scratch Postgres + throwaway Redis with the other integration
 * tests; see cache/test-helpers.ts for setup requirements. Files run
 * sequentially (api/vitest.config.ts).
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMeterBalance, setMeterBalance } from "../../cache/meter/index.ts";
import {
  closeTestState,
  makeCycle,
  makeMeter,
  makePlan,
  makeProductLine,
  makeTenant,
  newProductLineId,
  resetTestState,
} from "../../cache/test-helpers.ts";
import { db } from "../../db/index.ts";
import {
  assignments,
  experiments,
  planMeters,
  productLines,
} from "../../db/schema.ts";
import { PRESERVE_CONCLUDING_PLAN } from "../../schemas/experiment.ts";
import { createAssignment } from "../tenant/assignment/service.ts";
import type { ExperimentCreateBody } from "./routes.ts";
import { concludeExperiment, createExperiment } from "./service.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

async function makeSynchronizedLine({
  synchronizedWith,
}: { synchronizedWith?: string } = {}): Promise<string> {
  const productLineId = newProductLineId();
  await db.insert(productLines).values({
    productLineId,
    createdAt: Date.now(),
    deprecatedAt: null,
    forceBillingCycleSynchronizationWithProductLineIds:
      synchronizedWith === undefined ? [] : [synchronizedWith],
    name: "Test product line",
    description: null,
  });
  return productLineId;
}

function createBody({
  assignmentTerms,
  treatments,
}: Pick<ExperimentCreateBody, "assignmentTerms" | "treatments">) {
  return {
    assignmentTerms,
    name: "Test experiment",
    description: null,
    treatments,
  };
}

async function openAssignments({ tenantId }: { tenantId: string }) {
  return db
    .select()
    .from(assignments)
    .where(and(eq(assignments.tenantId, tenantId), isNull(assignments.endsAt)));
}

describe("experiment enrollment", () => {
  it("enrolls assigned tenants on their treatment plans", async () => {
    const lineA = await makeProductLine();
    const lineB = await makeProductLine();
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const planB1 = await makePlan({ productLineId: lineB });
    const planB2 = await makePlan({ productLineId: lineB });
    const meterId = await makeMeter({ productLineId: lineA });
    await db.insert(planMeters).values({
      planId: planA1,
      meterId,
      defaultMicrocredits: 1_000_000,
      limitMicrocredits: null,
      reset: null,
      rollovers: null,
      topUpPricesPerCredit: null,
      topUpCreditPackSizes: null,
    });
    const tenantA = await makeTenant();
    const tenantB = await makeTenant();
    const cycleId = await makeCycle();
    const startsAt = Date.now();

    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: { cycleId, startsAt, endsAt: null },
        treatments: [
          {
            planIds: [planA1, planB1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantA],
          },
          {
            planIds: [planA2, planB2],
            tenantPercentage: 50,
            assignedTenantIds: [tenantB],
          },
        ],
      }),
    });
    if ("error" in created) {
      throw new Error(created.error);
    }

    const aOpen = await openAssignments({ tenantId: tenantA });
    expect(aOpen.map((row) => row.planId).sort()).toEqual(
      [planA1, planB1].sort(),
    );
    expect(
      aOpen.every(
        (row) =>
          row.experimentId === created.experimentId &&
          row.cycleId === cycleId &&
          row.startsAt === startsAt &&
          row.endsAt === null,
      ),
    ).toBe(true);
    const bOpen = await openAssignments({ tenantId: tenantB });
    expect(bOpen.map((row) => row.planId).sort()).toEqual(
      [planA2, planB2].sort(),
    );
    // Meter balances initialize from the plan's default allocations.
    expect(await getMeterBalance({ meterId, tenantId: tenantA })).toBe(
      1_000_000,
    );
    expect(await getMeterBalance({ meterId, tenantId: tenantB })).toBeNull();
  });

  it("requires assignment terms when treatments assign tenants", async () => {
    const lineA = await makeProductLine();
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const tenantId = await makeTenant();

    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: null,
        treatments: [
          {
            planIds: [planA1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantId],
          },
          { planIds: [planA2], tenantPercentage: 50, assignedTenantIds: null },
        ],
      }),
    });
    expect("error" in created).toBe(true);
  });

  it("creates without enrollment when no tenants are assigned", async () => {
    const lineA = await makeProductLine();
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });

    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: null,
        treatments: [
          { planIds: [planA1], tenantPercentage: 50, assignedTenantIds: null },
          { planIds: [planA2], tenantPercentage: 50, assignedTenantIds: null },
        ],
      }),
    });
    expect("error" in created).toBe(false);
  });

  it("writes nothing when an assigned tenant would break the sync anchor", async () => {
    const lineA = await makeSynchronizedLine();
    const lineB = await makeSynchronizedLine({ synchronizedWith: lineA });
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const planB = await makePlan({ productLineId: lineB });
    const tenantId = await makeTenant();
    // The tenant's open line-B assignment anchors the group to an earlier start.
    await createAssignment({
      assignment: {
        addOns: [],
        cycleId: await makeCycle(),
        endsAt: null,
        experimentId: null,
        planId: planB,
        startsAt: Date.now() - 60_000,
      },
      tenantId,
    });
    const experimentsBefore = await db.select().from(experiments);

    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: {
          cycleId: await makeCycle(),
          startsAt: Date.now(),
          endsAt: null,
        },
        treatments: [
          {
            planIds: [planA1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantId],
          },
          { planIds: [planA2], tenantPercentage: 50, assignedTenantIds: null },
        ],
      }),
    });

    expect("error" in created).toBe(true);
    const experimentsAfter = await db.select().from(experiments);
    expect(experimentsAfter.length).toBe(experimentsBefore.length);
    const open = await openAssignments({ tenantId });
    expect(open.map((row) => row.planId)).toEqual([planB]);
  });
});

describe("experiment conclusion", () => {
  it("rolls assigned tenants onto the concluding plan", async () => {
    const lineA = await makeProductLine();
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const winner = await makePlan({ productLineId: lineA });
    const tenantA = await makeTenant();
    const tenantB = await makeTenant();
    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: {
          cycleId: await makeCycle(),
          startsAt: Date.now() - 60_000,
          endsAt: null,
        },
        treatments: [
          {
            planIds: [planA1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantA],
          },
          {
            planIds: [planA2],
            tenantPercentage: 50,
            assignedTenantIds: [tenantB],
          },
        ],
      }),
    });
    if ("error" in created) {
      throw new Error(created.error);
    }

    const concluded = await concludeExperiment({
      body: { concludingPlans: [{ productLineId: lineA, planId: winner }] },
      experimentId: created.experimentId,
    });
    if (concluded === null || "error" in concluded) {
      throw new Error(concluded === null ? "not found" : concluded.error);
    }

    for (const tenantId of [tenantA, tenantB]) {
      const [open] = await openAssignments({ tenantId });
      expect(open?.planId).toBe(winner);
      expect(open?.experimentId).toBe(created.experimentId);
      const closed = await db
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.tenantId, tenantId),
            isNotNull(assignments.endsAt),
          ),
        );
      // The superseded treatment assignment ended exactly when the roll started.
      expect(closed.length).toBe(1);
      expect(closed[0]?.endsAt).toBe(open?.startsAt);
    }
  });

  it("ends assignments when the concluding plan is null", async () => {
    const lineA = await makeProductLine();
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const tenantId = await makeTenant();
    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: {
          cycleId: await makeCycle(),
          startsAt: Date.now() - 60_000,
          endsAt: null,
        },
        treatments: [
          {
            planIds: [planA1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantId],
          },
          { planIds: [planA2], tenantPercentage: 50, assignedTenantIds: null },
        ],
      }),
    });
    if ("error" in created) {
      throw new Error(created.error);
    }

    const concluded = await concludeExperiment({
      body: { concludingPlans: [{ productLineId: lineA, planId: null }] },
      experimentId: created.experimentId,
    });
    if (concluded === null || "error" in concluded) {
      throw new Error(concluded === null ? "not found" : concluded.error);
    }

    expect(await openAssignments({ tenantId })).toEqual([]);
  });

  it("re-anchors untouched synchronized lines without resetting meter balances", async () => {
    const lineA = await makeSynchronizedLine();
    const lineB = await makeSynchronizedLine({ synchronizedWith: lineA });
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const winner = await makePlan({ productLineId: lineA });
    const planB = await makePlan({ productLineId: lineB });
    const meterB = await makeMeter({ productLineId: lineB });
    await db.insert(planMeters).values({
      planId: planB,
      meterId: meterB,
      defaultMicrocredits: 500_000,
      limitMicrocredits: null,
      reset: null,
      rollovers: null,
      topUpPricesPerCredit: null,
      topUpCreditPackSizes: null,
    });
    const tenantId = await makeTenant();
    const cycleId = await makeCycle();
    const startsAt = Date.now() - 60_000;
    // The tenant's line-B membership predates the experiment, on the group anchor.
    await createAssignment({
      assignment: {
        addOns: [],
        cycleId,
        endsAt: null,
        experimentId: null,
        planId: planB,
        startsAt,
      },
      tenantId,
    });
    // Usage drained some of B's meter below the plan default.
    await setMeterBalance({
      balanceMicrocredits: 123_456,
      meterId: meterB,
      tenantId,
    });
    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: { cycleId, startsAt, endsAt: null },
        treatments: [
          {
            planIds: [planA1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantId],
          },
          { planIds: [planA2], tenantPercentage: 50, assignedTenantIds: null },
        ],
      }),
    });
    if ("error" in created) {
      throw new Error(created.error);
    }

    const concluded = await concludeExperiment({
      body: { concludingPlans: [{ productLineId: lineA, planId: winner }] },
      experimentId: created.experimentId,
    });
    if (concluded === null || "error" in concluded) {
      throw new Error(concluded === null ? "not found" : concluded.error);
    }

    const open = await openAssignments({ tenantId });
    expect(open.length).toBe(2);
    const lineAOpen = open.find((row) => row.productLineId === lineA);
    const lineBOpen = open.find((row) => row.productLineId === lineB);
    expect(lineAOpen?.planId).toBe(winner);
    expect(lineAOpen?.cycleId).toBe(cycleId);
    // Line B keeps its plan (and is not attributed to the experiment)...
    expect(lineBOpen?.planId).toBe(planB);
    expect(lineBOpen?.experimentId).toBeNull();
    // ...re-anchored to one shared startsAt/cycleId with the roll...
    expect(lineBOpen?.startsAt).toBeGreaterThan(startsAt);
    expect(lineBOpen?.startsAt).toBe(lineAOpen?.startsAt);
    expect(lineBOpen?.cycleId).toBe(cycleId);
    // ...and its meter balance is untouched.
    expect(await getMeterBalance({ meterId: meterB, tenantId })).toBe(123_456);
  });

  it("leaves assignments untouched when every line is preserved", async () => {
    const lineA = await makeProductLine();
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const tenantId = await makeTenant();
    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: {
          cycleId: await makeCycle(),
          startsAt: Date.now() - 60_000,
          endsAt: null,
        },
        treatments: [
          {
            planIds: [planA1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantId],
          },
          { planIds: [planA2], tenantPercentage: 50, assignedTenantIds: null },
        ],
      }),
    });
    if ("error" in created) {
      throw new Error(created.error);
    }
    const [before] = await openAssignments({ tenantId });

    const concluded = await concludeExperiment({
      body: {
        concludingPlans: [
          { productLineId: lineA, planId: PRESERVE_CONCLUDING_PLAN },
        ],
      },
      experimentId: created.experimentId,
    });
    if (concluded === null || "error" in concluded) {
      throw new Error(concluded === null ? "not found" : concluded.error);
    }
    expect(concluded.concludedAt).not.toBeNull();

    // Bit-for-bit unchanged: same assignment row, same anchor.
    const [after] = await openAssignments({ tenantId });
    expect(after?.assignmentId).toBe(before?.assignmentId);
    expect(after?.startsAt).toBe(before?.startsAt);
    expect(after?.planId).toBe(planA1);
  });

  it("re-anchors a preserved line only when a synchronized sibling concludes", async () => {
    const lineA = await makeSynchronizedLine();
    const lineB = await makeSynchronizedLine({ synchronizedWith: lineA });
    const planA1 = await makePlan({ productLineId: lineA });
    const planA2 = await makePlan({ productLineId: lineA });
    const planB1 = await makePlan({ productLineId: lineB });
    const planB2 = await makePlan({ productLineId: lineB });
    const winner = await makePlan({ productLineId: lineA });
    const tenantId = await makeTenant();
    const cycleId = await makeCycle();
    const startsAt = Date.now() - 60_000;
    const created = await createExperiment({
      experiment: createBody({
        assignmentTerms: { cycleId, startsAt, endsAt: null },
        treatments: [
          {
            planIds: [planA1, planB1],
            tenantPercentage: 50,
            assignedTenantIds: [tenantId],
          },
          {
            planIds: [planA2, planB2],
            tenantPercentage: 50,
            assignedTenantIds: null,
          },
        ],
      }),
    });
    if ("error" in created) {
      throw new Error(created.error);
    }
    const openBefore = await openAssignments({ tenantId });
    const lineBBefore = openBefore.find((row) => row.productLineId === lineB);

    const concluded = await concludeExperiment({
      body: {
        concludingPlans: [
          { productLineId: lineA, planId: winner },
          { productLineId: lineB, planId: PRESERVE_CONCLUDING_PLAN },
        ],
      },
      experimentId: created.experimentId,
    });
    if (concluded === null || "error" in concluded) {
      throw new Error(concluded === null ? "not found" : concluded.error);
    }

    const open = await openAssignments({ tenantId });
    expect(open.length).toBe(2);
    const lineAOpen = open.find((row) => row.productLineId === lineA);
    const lineBOpen = open.find((row) => row.productLineId === lineB);
    expect(lineAOpen?.planId).toBe(winner);
    /* B kept its plan and experiment attribution, but shares the roll's
     * anchor because its synchronized sibling changed. */
    expect(lineBOpen?.planId).toBe(planB1);
    expect(lineBOpen?.assignmentId).not.toBe(lineBBefore?.assignmentId);
    expect(lineBOpen?.startsAt).toBe(lineAOpen?.startsAt);
    expect(lineBOpen?.cycleId).toBe(cycleId);
    expect(lineBOpen?.experimentId).toBe(created.experimentId);
  });
});
