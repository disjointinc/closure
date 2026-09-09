/**
 * v0/experiment/service.ts -- experiment business logic. Treatments are
 * passed inline on create; their ids are server-minted. Experiments are
 * concluded, never deleted.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  experiments,
  experimentTreatmentPlans,
  experimentTreatmentTenants,
  experimentTreatments,
  plans,
  tenants,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Experiment } from "../../schemas/experiment.ts";
import type { Treatment } from "../../schemas/treatment.ts";
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
    const assigned = tenantRows.filter(
      (tenant) => tenant.treatmentId === treatment.treatmentId,
    );
    return {
      treatmentId: treatment.treatmentId,
      planIds: planRows
        .filter((plan) => plan.treatmentId === treatment.treatmentId)
        .map((plan) => plan.planId),
      tenantPercentage: treatment.tenantPercentage,
      assignedTenantIds: assigned.length
        ? assigned.map((tenant) => tenant.tenantId)
        : null,
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

async function resolvePlanLines({
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

function linesPerTreatment({
  planLines,
  treatments,
}: {
  planLines: Map<string, string>;
  treatments: { planIds: string[] }[];
}): Set<string>[] | null {
  const seen: Set<string>[] = [];
  for (const treatment of treatments) {
    if (new Set(treatment.planIds).size !== treatment.planIds.length) {
      return null;
    }
    const lines = new Set<string>();
    for (const planId of treatment.planIds) {
      const line = planLines.get(planId);
      if (line === undefined || lines.has(line)) {
        return null;
      }
      lines.add(line);
    }
    seen.push(lines);
  }
  return seen;
}

function sameLines({
  treatmentLines,
}: {
  treatmentLines: Set<string>[];
}): boolean {
  const [first, ...rest] = treatmentLines;
  return rest.every(
    (lines) =>
      lines.size === first.size && [...lines].every((line) => first.has(line)),
  );
}

export async function createExperiment({
  experiment,
}: {
  experiment: ExperimentCreateBody;
}): Promise<Experiment | { error: string }> {
  const planLines = await resolvePlanLines({
    planIds: experiment.treatments.flatMap((treatment) => treatment.planIds),
  });
  if (!planLines) {
    return { error: "treatments must reference known plans" };
  }
  const treatmentLines = linesPerTreatment({
    planLines,
    treatments: experiment.treatments,
  });
  if (!treatmentLines) {
    return {
      error: "each treatment must hold at most one plan per product line",
    };
  }
  if (!sameLines({ treatmentLines })) {
    return { error: "treatments must touch the same product lines" };
  }
  const tenantIds = experiment.treatments.flatMap(
    (treatment) => treatment.assignedTenantIds ?? [],
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
  const experimentId = generateId({ prefix: "experiment" });
  await db.transaction(async (tx) => {
    await tx.insert(experiments).values({
      experimentId,
      createdAt: Date.now(),
      concludedAt: null,
      concludingPlans: null,
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
  const planLines = await resolvePlanLines({
    planIds: experiment.treatments.flatMap((treatment) => treatment.planIds),
  });
  if (!planLines) {
    return { error: "treatments must reference known plans" };
  }
  const touchedLines = new Set(planLines.values());
  const conclusionLines = body.concludingPlans.map(
    (conclusion) => conclusion.productLineId,
  );
  if (
    new Set(conclusionLines).size !== conclusionLines.length ||
    conclusionLines.length !== touchedLines.size ||
    !conclusionLines.every((line) => touchedLines.has(line))
  ) {
    return {
      error:
        "conclusion must name each product line the treatments touched exactly once",
    };
  }
  const conclusionPlanLines = await resolvePlanLines({
    planIds: body.concludingPlans
      .map((conclusion) => conclusion.planId)
      .filter((planId): planId is string => planId !== null),
  });
  if (
    !conclusionPlanLines ||
    !body.concludingPlans.every(
      (conclusion) =>
        conclusion.planId === null ||
        conclusionPlanLines.get(conclusion.planId) === conclusion.productLineId,
    )
  ) {
    return {
      error:
        "concluding plans must exist and belong to the named product lines",
    };
  }
  await db
    .update(experiments)
    .set({
      concludedAt: Date.now(),
      concludingPlans: body.concludingPlans,
    })
    .where(eq(experiments.experimentId, experimentId));
  return getExperiment({ experimentId });
}
