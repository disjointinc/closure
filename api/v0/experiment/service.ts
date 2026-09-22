/**
 * v0/experiment/service.ts -- experiment business logic. Treatments are
 * passed inline on create; their ids are server-minted. Experiments are
 * concluded, never deleted.
 *
 * Creating an experiment with assigned tenants enrolls them on the
 * treatment plans server-side (one assignment per tenant and plan, tagged
 * with the experimentId); concluding rolls every assigned tenant onto the
 * concluding plans, re-anchoring their whole billing-cycle-synchronized
 * group so the shared startsAt/cycleId invariant holds. A concluding planId
 * of PRESERVE_CONCLUDING_PLAN instead leaves the line's tenants on whatever
 * they are currently assigned.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { setMeterBalance } from "../../cache/meter/index.ts";
import { db } from "../../db/index.ts";
import {
  assignmentAddOns,
  assignments,
  experiments,
  experimentTreatmentPlans,
  experimentTreatmentTenants,
  experimentTreatments,
  planMeters,
  plans,
  tenants,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import {
  PRESERVE_CONCLUDING_PLAN,
  type Experiment,
} from "../../schemas/experiment.ts";
import type { Treatment } from "../../schemas/treatment.ts";
import { getSynchronizedLineIds } from "../product-line/service.ts";
import {
  createAssignment,
  validateAssignmentTerms,
} from "../tenant/assignment/service.ts";
import type { ConcludeExperimentBody, ExperimentCreateBody } from "./routes.ts";

async function listTreatments({
  experimentId,
}: {
  experimentId: string;
}): Promise<Treatment[]> {
  const treatmentRows = await db
    .select()
    .from(experimentTreatments)
    .where(eq(experimentTreatments.experimentId, experimentId));
  const planRows = await db
    .select()
    .from(experimentTreatmentPlans)
    .where(eq(experimentTreatmentPlans.experimentId, experimentId));
  const tenantRows = await db
    .select()
    .from(experimentTreatmentTenants)
    .where(eq(experimentTreatmentTenants.experimentId, experimentId));
  return treatmentRows.map((treatment) => {
    const assignedTenantRows = tenantRows.filter(
      (tenant) => tenant.treatmentId === treatment.treatmentId,
    );
    return {
      treatmentId: treatment.treatmentId,
      planIds: planRows
        .filter((plan) => plan.treatmentId === treatment.treatmentId)
        .map((plan) => plan.planId),
      tenantPercentage: treatment.tenantPercentage,
      assignedTenantIds: assignedTenantRows.map((tenant) => tenant.tenantId),
    };
  });
}

export async function getExperiment({
  experimentId,
}: {
  experimentId: string;
}): Promise<Experiment | null> {
  const [row] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.experimentId, experimentId));
  if (!row) {
    return null;
  }
  const treatments = await listTreatments({ experimentId });
  return {
    experimentId: row.experimentId,
    createdAt: row.createdAt,
    concludedAt: row.concludedAt,
    concludingPlans: row.concludingPlans,
    name: row.name,
    description: row.description,
    treatments,
  };
}

export async function listExperiments(): Promise<Experiment[]> {
  const rows = await db.select().from(experiments);
  const found = await Promise.all(
    rows.map((row) => getExperiment({ experimentId: row.experimentId })),
  );
  return found.filter((experiment) => experiment !== null);
}

/**
 * Map each plan id to the product line it belongs to. Returns null when any
 * plan id is unknown, so callers can reject bad references up front.
 */
async function resolveProductLineByPlanId({
  planIds,
}: {
  planIds: string[];
}): Promise<Map<string, string> | null> {
  if (planIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select()
    .from(plans)
    .where(inArray(plans.planId, planIds));
  if (rows.length !== new Set(planIds).size) {
    return null;
  }
  return new Map(rows.map((row) => [row.planId, row.productLineId]));
}

/**
 * The set of product lines each treatment holds plans in, one set per
 * treatment. Returns null when a treatment repeats a plan id or holds two
 * plans in the same line.
 */
function lineIdsPerTreatment({
  productLineByPlanId,
  treatments,
}: {
  productLineByPlanId: Map<string, string>;
  treatments: { planIds: string[] }[];
}): Set<string>[] | null {
  const lineIdsPerTreatment: Set<string>[] = [];
  for (const treatment of treatments) {
    if (new Set(treatment.planIds).size !== treatment.planIds.length) {
      return null;
    }
    const treatmentLineIds = new Set<string>();
    for (const planId of treatment.planIds) {
      const lineId = productLineByPlanId.get(planId);
      if (lineId === undefined || treatmentLineIds.has(lineId)) {
        return null;
      }
      treatmentLineIds.add(lineId);
    }
    lineIdsPerTreatment.push(treatmentLineIds);
  }
  return lineIdsPerTreatment;
}

/** Whether every treatment holds plans in exactly the same product lines. */
function sameLineIdsAcrossTreatments({
  treatmentLineIds,
}: {
  treatmentLineIds: Set<string>[];
}): boolean {
  const [firstTreatmentLineIds, ...otherTreatmentLineIds] = treatmentLineIds;
  return otherTreatmentLineIds.every(
    (lineIds) =>
      lineIds.size === firstTreatmentLineIds.size &&
      [...lineIds].every((lineId) => firstTreatmentLineIds.has(lineId)),
  );
}

export async function createExperiment({
  experiment,
}: {
  experiment: ExperimentCreateBody;
}): Promise<Experiment | { error: string }> {
  const productLineByPlanId = await resolveProductLineByPlanId({
    planIds: experiment.treatments.flatMap((treatment) => treatment.planIds),
  });
  if (!productLineByPlanId) {
    return { error: "treatments must reference known plans" };
  }
  const treatmentLineIds = lineIdsPerTreatment({
    productLineByPlanId,
    treatments: experiment.treatments,
  });
  if (!treatmentLineIds) {
    return {
      error: "each treatment must hold at most one plan per product line",
    };
  }
  if (!sameLineIdsAcrossTreatments({ treatmentLineIds })) {
    return { error: "treatments must touch the same product lines" };
  }
  const tenantIds = experiment.treatments.flatMap(
    (treatment) => treatment.assignedTenantIds,
  );
  if (new Set(tenantIds).size !== tenantIds.length) {
    return { error: "each tenant must be assigned at most once" };
  }
  const tenantRows = tenantIds.length
    ? await db
        .select({ tenantId: tenants.tenantId })
        .from(tenants)
        .where(inArray(tenants.tenantId, tenantIds))
    : [];
  if (tenantRows.length !== tenantIds.length) {
    return { error: "treatments must reference known tenants" };
  }
  const enrollments = experiment.treatments.flatMap((treatment) =>
    treatment.assignedTenantIds.flatMap((tenantId) =>
      treatment.planIds.map((planId) => ({ planId, tenantId })),
    ),
  );
  if (enrollments.length > 0) {
    if (experiment.assignmentTerms === null) {
      return {
        error: "assignment terms are required when treatments assign tenants",
      };
    }
    const assignmentTerms = experiment.assignmentTerms;
    for (const { planId, tenantId } of enrollments) {
      const productLineId = productLineByPlanId.get(planId);
      if (productLineId === undefined) {
        return { error: "treatments must reference known plans" };
      }
      const invalid = await validateAssignmentTerms({
        cycleId: assignmentTerms.cycleId,
        productLineId,
        startsAt: assignmentTerms.startsAt,
        tenantId,
      });
      if (invalid !== null) {
        return { error: invalid };
      }
    }
  }
  const experimentId = generateId({ prefix: "experiment" });
  await db.transaction(async (tx) => {
    await tx.insert(experiments).values({
      experimentId,
      createdAt: Date.now(),
      concludedAt: null,
      concludingPlans: [],
      name: experiment.name,
      description: experiment.description,
    });
    for (const treatment of experiment.treatments) {
      const treatmentId = generateId({ prefix: "treatment" });
      await tx.insert(experimentTreatments).values({
        experimentId,
        treatmentId,
        tenantPercentage: treatment.tenantPercentage,
      });
      await tx.insert(experimentTreatmentPlans).values(
        treatment.planIds.map((planId) => ({
          experimentId,
          treatmentId,
          planId,
        })),
      );
      if (!treatment.assignedTenantIds?.length) {
        continue;
      }
      await tx.insert(experimentTreatmentTenants).values(
        treatment.assignedTenantIds.map((tenantId) => ({
          experimentId,
          treatmentId,
          tenantId,
        })),
      );
    }
  });
  if (experiment.assignmentTerms !== null) {
    const assignmentTerms = experiment.assignmentTerms;
    for (const { planId, tenantId } of enrollments) {
      const assignment = await createAssignment({
        assignment: {
          addOns: [],
          cycleId: assignmentTerms.cycleId,
          endsAt: assignmentTerms.endsAt,
          experimentId,
          planId,
          startsAt: assignmentTerms.startsAt,
        },
        tenantId,
      });
      /* Pre-validated above, so a failure here means the tenant's
       * assignments changed mid-request. */
      if (assignment === null || "error" in assignment) {
        console.error("experiment enrollment failed", {
          assignment,
          experimentId,
          planId,
          tenantId,
        });
      }
    }
  }
  // The experiment row always exists once its id is stored.
  return getExperiment({ experimentId }) as Promise<Experiment>;
}

export async function concludeExperiment({
  body,
  experimentId,
}: {
  body: ConcludeExperimentBody;
  experimentId: string;
}): Promise<Experiment | null | { error: string }> {
  const experiment = await getExperiment({ experimentId });
  if (!experiment) {
    return null;
  }
  const productLineByPlanId = await resolveProductLineByPlanId({
    planIds: experiment.treatments.flatMap((treatment) => treatment.planIds),
  });
  if (!productLineByPlanId) {
    return { error: "treatments must reference known plans" };
  }
  // Every product line the experiment's treatments hold a plan in.
  const experimentLineIds = new Set(productLineByPlanId.values());
  const concludingLineIds = body.concludingPlans.map(
    (conclusion) => conclusion.productLineId,
  );
  if (
    new Set(concludingLineIds).size !== concludingLineIds.length ||
    concludingLineIds.length !== experimentLineIds.size ||
    !concludingLineIds.every((lineId) => experimentLineIds.has(lineId))
  ) {
    return {
      error:
        "conclusion must name each product line the treatments touched exactly once",
    };
  }
  // Only real plan ids resolve; PRESERVE_CONCLUDING_PLAN names no plan.
  const productLineByConcludingPlanId = await resolveProductLineByPlanId({
    planIds: body.concludingPlans
      .map((conclusion) => conclusion.planId)
      .filter(
        (planId): planId is string =>
          planId !== null && planId !== PRESERVE_CONCLUDING_PLAN,
      ),
  });
  if (
    !productLineByConcludingPlanId ||
    !body.concludingPlans.every(
      (conclusion) =>
        conclusion.planId === null ||
        conclusion.planId === PRESERVE_CONCLUDING_PLAN ||
        productLineByConcludingPlanId.get(conclusion.planId) ===
          conclusion.productLineId,
    )
  ) {
    return {
      error:
        "concluding plans must exist and belong to the named product lines",
    };
  }
  const now = Date.now();
  const concludingPlanIdByLineId = new Map(
    body.concludingPlans.map((conclusion) => [
      conclusion.productLineId,
      conclusion.planId,
    ]),
  );
  /* Group the experiment's lines into billing-cycle-synchronized components
   * (connected components of the synchronization graph, which can include
   * lines the experiment itself never touched). This grouping is
   * tenant-independent: every open assignment inside one component shares a
   * single startsAt/cycleId anchor, so concluding anything in a component
   * re-anchors that component as a whole. */
  const lineIdsAlreadyGrouped = new Set<string>();
  const synchronizedLineGroups: Set<string>[] = [];
  for (const lineId of experimentLineIds) {
    if (lineIdsAlreadyGrouped.has(lineId)) {
      continue;
    }
    const synchronizedLineIds = await getSynchronizedLineIds({
      productLineId: lineId,
    });
    for (const groupedLineId of synchronizedLineIds) {
      lineIdsAlreadyGrouped.add(groupedLineId);
    }
    synchronizedLineGroups.push(synchronizedLineIds);
  }
  const assignedTenantIds = [
    ...new Set(
      experiment.treatments.flatMap((treatment) => treatment.assignedTenantIds),
    ),
  ];
  /* Roll every assigned tenant onto the concluding plans. Untouched lines in
   * a group keep their plan, add-ons, and meter balances under the new
   * anchor; experiment lines get the concluding plan (fresh balances), end
   * when the concluding planId is null, or stay as-is when it is
   * PRESERVE_CONCLUDING_PLAN. The roll is batched: one read of every open
   * assignment in play, a pure pass building the row changes, then one
   * update or insert per row kind. */
  const groupIndexByLineId = new Map<string, number>();
  synchronizedLineGroups.forEach((lineIds, index) => {
    for (const lineId of lineIds) {
      groupIndexByLineId.set(lineId, index);
    }
  });
  type AssignmentRow = typeof assignments.$inferSelect;
  // Every open assignment any assigned tenant holds in any grouped line.
  const openAssignmentRows: AssignmentRow[] =
    assignedTenantIds.length > 0 && groupIndexByLineId.size > 0
      ? await db
          .select()
          .from(assignments)
          .where(
            and(
              inArray(assignments.tenantId, assignedTenantIds),
              inArray(assignments.productLineId, [
                ...groupIndexByLineId.keys(),
              ]),
              isNull(assignments.endsAt),
            ),
          )
      : [];
  /* Bucket the rows by tenant and group: one bucket is one tenant's open
   * assignments inside one synchronized group, all sharing that group's
   * current anchor. */
  const openAssignmentsByTenantAndGroup = new Map<
    string,
    Map<number, AssignmentRow[]>
  >();
  for (const row of openAssignmentRows) {
    const groupIndex = groupIndexByLineId.get(row.productLineId);
    if (groupIndex === undefined) {
      continue;
    }
    const rowsByGroupIndex =
      openAssignmentsByTenantAndGroup.get(row.tenantId) ??
      new Map<number, AssignmentRow[]>();
    const groupOpenAssignments = rowsByGroupIndex.get(groupIndex) ?? [];
    groupOpenAssignments.push(row);
    rowsByGroupIndex.set(groupIndex, groupOpenAssignments);
    openAssignmentsByTenantAndGroup.set(row.tenantId, rowsByGroupIndex);
  }
  /* Build the row changes without touching the database:
   * - assignmentIdsToEnd: every open assignment in play ends now, whether it
   *   is recreated (untouched or preserved line), replaced (concluding
   *   plan), or simply ended (concluding planId is null).
   * - untouchedLineRecreations: lines the experiment never touched, plus
   *   lines concluded with PRESERVE_CONCLUDING_PLAN, keep their plan and
   *   experimentId under the group's new anchor. Recreate rather than
   *   update in place: startsAt is assignment history, and the ended row
   *   records when the re-anchor happened.
   * - concludingAssignments: fresh assignments onto the concluding plans,
   *   tagged with the experimentId. */
  const assignmentIdsToEnd: string[] = [];
  const untouchedLineRecreations: {
    sourceAssignmentId: string;
    recreatedAssignment: typeof assignments.$inferInsert;
  }[] = [];
  const concludingAssignments: (typeof assignments.$inferInsert)[] = [];
  for (const rowsByGroupIndex of openAssignmentsByTenantAndGroup.values()) {
    for (const groupOpenAssignments of rowsByGroupIndex.values()) {
      /* A bucket with no active experiment-line rows (every experiment line
       * preserved, or none present) is left completely untouched: no ends,
       * no re-anchor, no new rows. */
      const hasActiveExperimentLine = groupOpenAssignments.some(
        (openAssignment) =>
          experimentLineIds.has(openAssignment.productLineId) &&
          concludingPlanIdByLineId.get(openAssignment.productLineId) !==
            PRESERVE_CONCLUDING_PLAN,
      );
      if (!hasActiveExperimentLine) {
        continue;
      }
      /* Every row in the bucket shares the group's anchor (enforced at
       * assignment create), so any row provides the cycleId the group keeps
       * as it re-anchors to now. */
      const [anchorAssignment] = groupOpenAssignments;
      if (anchorAssignment === undefined) {
        continue;
      }
      const newGroupAnchor = {
        cycleId: anchorAssignment.cycleId,
        startsAt: now,
      };
      for (const openAssignment of groupOpenAssignments) {
        assignmentIdsToEnd.push(openAssignment.assignmentId);
        /* The line's outcome: PRESERVE_CONCLUDING_PLAN for untouched lines
         * and lines concluded with preserve, null to end with no
         * replacement, otherwise the concluding plan id. */
        const outcome = experimentLineIds.has(openAssignment.productLineId)
          ? (concludingPlanIdByLineId.get(openAssignment.productLineId) ?? null)
          : PRESERVE_CONCLUDING_PLAN;
        if (outcome === PRESERVE_CONCLUDING_PLAN) {
          untouchedLineRecreations.push({
            sourceAssignmentId: openAssignment.assignmentId,
            recreatedAssignment: {
              assignmentId: generateId({ prefix: "assignment" }),
              tenantId: openAssignment.tenantId,
              planId: openAssignment.planId,
              productLineId: openAssignment.productLineId,
              experimentId: openAssignment.experimentId,
              cycleId: newGroupAnchor.cycleId,
              createdAt: now,
              startsAt: newGroupAnchor.startsAt,
              endsAt: null,
            },
          });
          continue;
        }
        if (outcome === null) {
          continue;
        }
        concludingAssignments.push({
          assignmentId: generateId({ prefix: "assignment" }),
          tenantId: openAssignment.tenantId,
          planId: outcome,
          productLineId: openAssignment.productLineId,
          experimentId,
          cycleId: newGroupAnchor.cycleId,
          createdAt: now,
          startsAt: newGroupAnchor.startsAt,
          endsAt: null,
        });
      }
    }
  }
  /* End every open assignment first: the one-open-per-line unique index must
   * be clear before the recreations and concluding assignments insert. */
  if (assignmentIdsToEnd.length > 0) {
    await db
      .update(assignments)
      .set({ endsAt: now })
      .where(inArray(assignments.assignmentId, assignmentIdsToEnd));
  }
  if (untouchedLineRecreations.length > 0) {
    // Add-ons live on the ended rows; carry them onto the recreations.
    const carriedAddOnRows = await db
      .select()
      .from(assignmentAddOns)
      .where(
        and(
          inArray(
            assignmentAddOns.assignmentId,
            untouchedLineRecreations.map(
              (recreation) => recreation.sourceAssignmentId,
            ),
          ),
          isNull(assignmentAddOns.deletedAt),
        ),
      );
    await db
      .insert(assignments)
      .values(
        untouchedLineRecreations.map(
          (recreation) => recreation.recreatedAssignment,
        ),
      );
    const recreatedIdBySourceId = new Map(
      untouchedLineRecreations.map((recreation) => [
        recreation.sourceAssignmentId,
        recreation.recreatedAssignment.assignmentId,
      ]),
    );
    const carriedAddOnInserts: (typeof assignmentAddOns.$inferInsert)[] =
      carriedAddOnRows.flatMap((addOn) => {
        const assignmentId = recreatedIdBySourceId.get(addOn.assignmentId);
        if (assignmentId === undefined) {
          return [];
        }
        return [
          {
            addOnId: generateId({ prefix: "add_on" }),
            assignmentId,
            addOnTypeId: addOn.addOnTypeId,
            createdAt: now,
            startsAt: addOn.startsAt,
            endsAt: addOn.endsAt,
            deletedAt: null,
          },
        ];
      });
    if (carriedAddOnInserts.length > 0) {
      await db.insert(assignmentAddOns).values(carriedAddOnInserts);
    }
  }
  if (concludingAssignments.length > 0) {
    await db.insert(assignments).values(concludingAssignments);
    const concludingPlanMeters = await db
      .select()
      .from(planMeters)
      .where(
        inArray(planMeters.planId, [
          ...new Set(
            concludingAssignments.map((assignment) => assignment.planId),
          ),
        ]),
      );
    /* Moving onto a new plan starts its meters fresh from the plan's default
     * allocations (same as any assignment create). Redis balances are
     * per-key, so these stay individual writes. */
    for (const concludingAssignment of concludingAssignments) {
      for (const planMeter of concludingPlanMeters) {
        if (planMeter.planId !== concludingAssignment.planId) {
          continue;
        }
        await setMeterBalance({
          balanceMicrocredits: planMeter.defaultMicrocredits,
          meterId: planMeter.meterId,
          tenantId: concludingAssignment.tenantId,
        });
      }
    }
  }
  await db
    .update(experiments)
    .set({
      concludedAt: now,
      concludingPlans: body.concludingPlans,
    })
    .where(eq(experiments.experimentId, experimentId));
  return getExperiment({ experimentId });
}
