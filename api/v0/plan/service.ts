/**
 * v0/plan/service.ts -- plan business logic. The call surface passes prices
 * (including inside meter top-up tiers) as full inline values; cycles are
 * first-class and referenced by id. Plans are immutable and versioned
 * (derivedFromPlanId), so deletes deprecate.
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
  values,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Plan, PlanMeter } from "../../schemas/plan.ts";
import { type Value, type ValueCreateBody } from "../../schemas/value.ts";

/** A top-up tier as written: prices carry inline value create-inputs. */
export type TopUpTierInput = {
  startingAt: number;
  prices: { cycleId: string; value: ValueCreateBody }[];
};

/** The create-input plan meter entry: microcredits, inline top-up values. */
export type PlanMeterInput = Omit<PlanMeter, "topUpPricesPerCredit"> & {
  topUpPricesPerCredit: TopUpTierInput[] | null;
};

/** The create-input plan: microcredits, prices carry inline values. */
export type PlanCreateBody = Omit<
  Plan,
  "planId" | "createdAt" | "deprecatedAt" | "prices" | "meters"
> & {
  prices: { cycleId: string; value: ValueCreateBody }[];
  meters: PlanMeterInput[] | null;
};

export type PlanPriceApi = { cycleId: string; value: Value };
type TopUpTierApi = { startingAt: number; prices: PlanPriceApi[] };
export type TopUpApi = TopUpTierApi[] | null;
export type PlanMeterApi = Omit<PlanMeter, "topUpPricesPerCredit"> & {
  topUpPricesPerCredit: TopUpApi;
};
export type PlanApi = Omit<Plan, "prices" | "meters"> & {
  prices: PlanPriceApi[];
  meters: PlanMeterApi[] | null;
};

/** Store an inline value, returning the minted value id. */
async function insertValue({
  value,
}: {
  value: ValueCreateBody;
}): Promise<string> {
  const valueId = generateId({ prefix: "value" });
  await db
    .insert(values)
    .values({
      valueId,
      createdAt: Date.now(),
      deprecatedAt: null,
      ...value,
    })
    .onConflictDoNothing();
  return valueId;
}

/** Store the inline values, returning the db-ready meter entry. */
async function resolveMeter({
  meter,
}: {
  meter: PlanMeterInput;
}): Promise<PlanMeter> {
  const topUps = meter.topUpPricesPerCredit;
  if (topUps === null) {
    return { ...meter, topUpPricesPerCredit: null };
  }
  return {
    ...meter,
    topUpPricesPerCredit: await Promise.all(
      topUps.map(async (tier) => ({
        startingAt: tier.startingAt,
        prices: await Promise.all(
          tier.prices.map(async (price) => ({
            cycleId: price.cycleId,
            valueId: await insertValue({ value: price.value }),
          })),
        ),
      })),
    ),
  };
}

export function topUpValueIds(
  topUp: PlanMeter["topUpPricesPerCredit"],
): string[] {
  if (topUp === null) {
    return [];
  }
  return topUp.flatMap((tier) => tier.prices.map((price) => price.valueId));
}

export function expandTopUp(
  topUp: PlanMeter["topUpPricesPerCredit"],
  valueFor: (valueId: string) => Value,
): TopUpApi {
  if (topUp === null) {
    return null;
  }
  return topUp.map((tier) => ({
    startingAt: tier.startingAt,
    prices: tier.prices.map((price) => ({
      cycleId: price.cycleId,
      value: valueFor(price.valueId),
    })),
  }));
}

export async function getPlan({
  planId,
}: {
  planId: string;
}): Promise<PlanApi | null> {
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
  const valueIds = [
    ...priceRows.map((price) => price.valueId),
    ...meterRows.flatMap((meter) => topUpValueIds(meter.topUpPricesPerCredit)),
  ];
  const valueRows = valueIds.length
    ? await db.select().from(values).where(inArray(values.valueId, valueIds))
    : [];
  const valueById = new Map(valueRows.map((value) => [value.valueId, value]));
  const valueFor = (valueId: string): Value =>
    // plan_prices.value_id FKs values (and top-ups are resolved on write),
    // so the row always exists.
    valueById.get(valueId) as Value;
  return {
    planId: row.planId,
    productLineId: row.productLineId,
    derivedFromPlanId: row.derivedFromPlanId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map((price) => ({
      cycleId: price.cycleId,
      value: valueFor(price.valueId),
    })),
    features: featureRows.length
      ? featureRows.map((feature) => ({
          featureId: feature.featureId,
          setTo: feature.setTo,
        }))
      : null,
    meters: meterRows.length
      ? meterRows.map((meter) => ({
          ...meter,
          topUpPricesPerCredit: expandTopUp(
            meter.topUpPricesPerCredit,
            valueFor,
          ),
        }))
      : null,
    addOnTypeIds: addOnTypeRows.length
      ? addOnTypeRows.map((addOnType) => addOnType.addOnTypeId)
      : null,
  };
}

export async function listPlans(): Promise<PlanApi[]> {
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
}): Promise<PlanApi | { error: string }> {
  /* Hard lock: a plan sells its own product line only, so every referenced
   * feature, meter, and add-on type must belong to plan.productLineId. */
  const [lineRow] = await db
    .select()
    .from(productLines)
    .where(eq(productLines.productLineId, plan.productLineId));
  if (!lineRow) {
    return { error: "product line not found" };
  }
  const referencedFeatureIds = (plan.features ?? []).map(
    (feature) => feature.featureId,
  );
  const referencedMeterIds = (plan.meters ?? []).map((meter) => meter.meterId);
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
  if (addOnTypeRows.length !== (plan.addOnTypeIds ?? []).length) {
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
  for (const price of plan.prices) {
    const valueId = await insertValue({ value: price.value });
    await db
      .insert(planPrices)
      .values({
        planId,
        cycleId: price.cycleId,
        valueId,
      })
      .onConflictDoNothing();
  }
  if (plan.features) {
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
  if (plan.meters) {
    for (const meter of plan.meters) {
      const resolved = await resolveMeter({ meter });
      await db
        .insert(planMeters)
        .values({
          planId,
          meterId: resolved.meterId,
          defaultMicrocredits: resolved.defaultMicrocredits,
          limitMicrocredits: resolved.limitMicrocredits,
          reset: resolved.reset,
          rollovers: resolved.rollovers,
          topUpPricesPerCredit: resolved.topUpPricesPerCredit,
          topUpCreditPackSizes: resolved.topUpCreditPackSizes,
        })
        .onConflictDoNothing();
    }
  }
  if (plan.addOnTypeIds) {
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
  return getPlan({ planId }) as Promise<PlanApi>;
}

/** Deprecate the plan, or return null if no such plan exists. */
export async function deprecatePlan({
  planId,
}: {
  planId: string;
}): Promise<PlanApi | null> {
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
