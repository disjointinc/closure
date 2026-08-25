/**
 * v0/experiments/service.ts -- experiment business logic. Treatments are
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
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Experiment | null> {
  const [row] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const treatmentRows = await db
    .select()
    .from(experimentTreatments)
    .where(eq(experimentTreatments.experiment, uniqueId));
  const tenantRows = await db
    .select()
    .from(experimentTreatmentTenants)
    .where(eq(experimentTreatmentTenants.experiment, uniqueId));
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    concluded_at: row.concludedAt,
    plan_assignment_at_conclusion: row.planAssignmentAtConclusion,
    name: row.name,
    description: row.description,
    treatments: treatmentRows.map((treatment) => {
      const assigned = tenantRows.filter(
        (tenant) =>
          tenant.experiment === treatment.experiment &&
          tenant.plan === treatment.plan,
      );
      return {
        plan: treatment.plan,
        tenant_percentage: treatment.tenantPercentage,
        assigned_tenants: assigned.length
          ? assigned.map((tenant) => tenant.tenant)
          : null,
      };
    }),
  };
}

export async function listExperiments(): Promise<Experiment[]> {
  const rows = await db.select().from(experiments);
  const found = await Promise.all(
    rows.map((row) => getExperiment({ uniqueId: row.uniqueId })),
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
      uniqueId: experiment.unique_id,
      createdAt: experiment.created_at,
      concludedAt: experiment.concluded_at,
      planAssignmentAtConclusion: experiment.plan_assignment_at_conclusion,
      name: experiment.name,
      description: experiment.description,
    })
    .onConflictDoNothing();
  for (const treatment of experiment.treatments) {
    await db
      .insert(experimentTreatments)
      .values({
        experiment: experiment.unique_id,
        plan: treatment.plan,
        tenantPercentage: treatment.tenant_percentage,
      })
      .onConflictDoNothing();
    if (treatment.assigned_tenants) {
      await db
        .insert(experimentTreatmentTenants)
        .values(
          treatment.assigned_tenants.map((tenant) => ({
            experiment: experiment.unique_id,
            plan: treatment.plan,
            tenant,
          })),
        )
        .onConflictDoNothing();
    }
  }
  return getExperiment({ uniqueId: experiment.unique_id });
}

/** Conclude the experiment, or return null if no such experiment exists. */
export async function concludeExperiment({
  body,
  uniqueId,
}: {
  body: ConcludeExperimentBody;
  uniqueId: string;
}): Promise<Experiment | null> {
  const updated = await db
    .update(experiments)
    .set({
      concludedAt: body.concluded_at,
      planAssignmentAtConclusion: body.plan_assignment_at_conclusion,
    })
    .where(eq(experiments.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getExperiment({ uniqueId });
}
