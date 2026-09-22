/**
 * v0/plan/service.ts -- plan business logic. Cycles are first-class and
 * referenced by id. Plans are immutable and versioned (derivedFromPlanId),
 * so deletes deprecate.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  addOnTypes,
  features,
  meters,
  planAddOnTypes,
  planFeatures,
  planMeters,
  planPrices,
  plans,
  productLines,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Plan } from "../../schemas/plan.ts";

/** The create-input plan: microcredits; server mints planId and stamps times. */
export type PlanCreateBody = Omit<
  Plan,
  "planId" | "createdAt" | "deprecatedAt"
>;

export async function getPlan({
  planId,
}: {
  planId: string;
}): Promise<Plan | null> {
  const [row] = await db.select().from(plans).where(eq(plans.planId, planId));
  if (!row) {
    return null;
  }
  const priceRows = await db
    .select()
    .from(planPrices)
    .where(eq(planPrices.planId, planId));
  const featureRows = await db
    .select()
    .from(planFeatures)
    .where(eq(planFeatures.planId, planId));
  const meterRows = await db
    .select()
    .from(planMeters)
    .where(eq(planMeters.planId, planId));
  const addOnTypeRows = await db
    .select()
    .from(planAddOnTypes)
    .where(eq(planAddOnTypes.planId, planId));
  return {
    planId: row.planId,
    productLineId: row.productLineId,
    derivedFromPlanId: row.derivedFromPlanId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map(({ planId: _planId, ...price }) => price),
    features: featureRows.map(({ planId: _planId, ...feature }) => feature),
    meters: meterRows.map(({ planId: _planId, ...meter }) => meter),
    addOnTypeIds: addOnTypeRows.map((addOnType) => addOnType.addOnTypeId),
  };
}

export async function listPlans(): Promise<Plan[]> {
  const rows = await db.select().from(plans);
  const found = await Promise.all(
    rows.map((row) => getPlan({ planId: row.planId })),
  );
  return found.filter((plan) => plan !== null);
}

export async function createPlan({
  plan,
}: {
  plan: PlanCreateBody;
}): Promise<Plan | { error: string }> {
  /* Hard lock: a plan sells its own product line only, so every referenced
   * feature, meter, and add-on type must belong to plan.productLineId. */
  const [lineRow] = await db
    .select()
    .from(productLines)
    .where(eq(productLines.productLineId, plan.productLineId));
  if (!lineRow) {
    return { error: "product line not found" };
  }
  const referencedFeatureIds = plan.features.map(
    (feature) => feature.featureId,
  );
  const referencedMeterIds = plan.meters.map((meter) => meter.meterId);
  const [featureRows, meterRows, addOnTypeRows] = await Promise.all([
    referencedFeatureIds.length
      ? db
          .select()
          .from(features)
          .where(inArray(features.featureId, referencedFeatureIds))
      : [],
    referencedMeterIds.length
      ? db
          .select()
          .from(meters)
          .where(inArray(meters.meterId, referencedMeterIds))
      : [],
    plan.addOnTypeIds?.length
      ? db
          .select()
          .from(addOnTypes)
          .where(inArray(addOnTypes.addOnTypeId, plan.addOnTypeIds))
      : [],
  ]);
  if (featureRows.length !== referencedFeatureIds.length) {
    return { error: "a referenced feature does not exist" };
  }
  if (meterRows.length !== referencedMeterIds.length) {
    return { error: "a referenced meter does not exist" };
  }
  if (addOnTypeRows.length !== plan.addOnTypeIds.length) {
    return { error: "a referenced add-on type does not exist" };
  }
  const sameLine = (row: { productLineId: string }) =>
    row.productLineId === plan.productLineId;
  /* Features and add-on types are hard-locked to one line; a meter may span
   * lines, so the plan's line only needs to be one of the meter's. */
  if (![...featureRows, ...addOnTypeRows].every(sameLine)) {
    return {
      error:
        "a referenced feature or add-on type belongs to another product line",
    };
  }
  if (
    !meterRows.every((meter) =>
      meter.productLineIds.includes(plan.productLineId),
    )
  ) {
    return {
      error: "a referenced meter does not apply to the plan's product line",
    };
  }
  const planId = generateId({ prefix: "plan" });
  await db
    .insert(plans)
    .values({
      planId,
      productLineId: plan.productLineId,
      derivedFromPlanId: plan.derivedFromPlanId,
      createdAt: Date.now(),
      deprecatedAt: null,
      name: plan.name,
      description: plan.description,
    })
    .onConflictDoNothing();
  if (plan.prices.length > 0) {
    await db
      .insert(planPrices)
      .values(
        plan.prices.map((price) => ({
          planId,
          cycleId: price.cycleId,
          amounts: price.amounts,
        })),
      )
      .onConflictDoNothing();
  }
  if (plan.features.length > 0) {
    await db
      .insert(planFeatures)
      .values(
        plan.features.map((feature) => ({
          planId,
          featureId: feature.featureId,
          setTo: feature.setTo,
        })),
      )
      .onConflictDoNothing();
  }
  if (plan.meters.length > 0) {
    await db
      .insert(planMeters)
      .values(
        plan.meters.map((meter) => ({
          ...meter,
          planId,
        })),
      )
      .onConflictDoNothing();
  }
  if (plan.addOnTypeIds.length > 0) {
    await db
      .insert(planAddOnTypes)
      .values(
        plan.addOnTypeIds.map((addOnTypeId) => ({
          planId,
          addOnTypeId,
        })),
      )
      .onConflictDoNothing();
  }
  // The plan row always exists once its id is stored.
  return getPlan({ planId }) as Promise<Plan>;
}

/** Deprecate the plan, or return null if no such plan exists. */
export async function deprecatePlan({
  planId,
}: {
  planId: string;
}): Promise<Plan | null> {
  const updated = await db
    .update(plans)
    .set({ deprecatedAt: Date.now() })
    .where(eq(plans.planId, planId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getPlan({ planId });
}
