/**
 * v0/experiment/service.ts -- experiment business logic. Treatments are
 * passed inline on create. Experiments are concluded, never deleted.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  experiments,
  experimentTreatmentTenants,
  experimentTreatments,
} from "../../db/schema.ts";
import type { Experiment } from "../../schemas/experiment.ts";
import type { ConcludeExperimentBody } from "./routes.ts";

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
  const treatmentRows = await db
    .select()
    .from(experimentTreatments)
    .where(eq(experimentTreatments.experimentId, experimentId));
  const tenantRows = await db
    .select()
    .from(experimentTreatmentTenants)
    .where(eq(experimentTreatmentTenants.experimentId, experimentId));
  return {
    experimentId: row.experimentId,
    createdAt: row.createdAt,
    concludedAt: row.concludedAt,
    concludingPlanId: row.concludingPlanId,
    name: row.name,
    description: row.description,
    treatments: treatmentRows.map((treatment) => {
      const assigned = tenantRows.filter(
        (tenant) =>
          tenant.experimentId === treatment.experimentId &&
          tenant.planId === treatment.planId,
      );
      return {
        planId: treatment.planId,
        tenantPercentage: treatment.tenantPercentage,
        assignedTenantIds: assigned.length
          ? assigned.map((tenant) => tenant.tenantId)
          : null,
      };
    }),
  };
}

export async function listExperiments(): Promise<Experiment[]> {
  const rows = await db.select().from(experiments);
  const found = await Promise.all(
    rows.map((row) => getExperiment({ experimentId: row.experimentId })),
  );
  return found.filter((experiment) => experiment !== null);
}

export async function createExperiment({
  experiment,
}: {
  experiment: Experiment;
}): Promise<Experiment | null> {
  await db
    .insert(experiments)
    .values({
      experimentId: experiment.experimentId,
      createdAt: experiment.createdAt,
      concludedAt: experiment.concludedAt,
      concludingPlanId: experiment.concludingPlanId,
      name: experiment.name,
      description: experiment.description,
    })
    .onConflictDoNothing();
  for (const treatment of experiment.treatments) {
    await db
      .insert(experimentTreatments)
      .values({
        experimentId: experiment.experimentId,
        planId: treatment.planId,
        tenantPercentage: treatment.tenantPercentage,
      })
      .onConflictDoNothing();
    if (treatment.assignedTenantIds) {
      await db
        .insert(experimentTreatmentTenants)
        .values(
          treatment.assignedTenantIds.map((tenantId) => ({
            experimentId: experiment.experimentId,
            planId: treatment.planId,
            tenantId,
          })),
        )
        .onConflictDoNothing();
    }
  }
  return getExperiment({ experimentId: experiment.experimentId });
}

/** Conclude the experiment, or return null if no such experiment exists. */
export async function concludeExperiment({
  body,
  experimentId,
}: {
  body: ConcludeExperimentBody;
  experimentId: string;
}): Promise<Experiment | null> {
  const updated = await db
    .update(experiments)
    .set({
      concludedAt: body.concludedAt,
      concludingPlanId: body.concludingPlanId,
    })
    .where(eq(experiments.experimentId, experimentId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getExperiment({ experimentId });
}
