/**
 * v0/plan/service.ts -- plan business logic. The call surface passes prices
 * (including inside meter top-up tiers) as full inline values; cycles are
 * first-class and referenced by id. Plans are immutable and versioned
 * (derivedFromPlanId), so deletes deprecate.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  planAddOns,
  planFeatures,
  planMeters,
  planPrices,
  plans,
  values,
} from "../../db/schema.ts";
import type { Plan, PlanMeter } from "../../schemas/plan.ts";
import { type Value } from "../../schemas/value.ts";
import type { PlanCreateBody, PlanMeterInput } from "./routes.ts";

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
          tier.prices.map(async (price) => {
            await db.insert(values).values(price.value).onConflictDoNothing();
            return {
              cycleId: price.cycleId,
              valueId: price.value.valueId,
            };
          }),
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
  const addOnRows = await db
    .select()
    .from(planAddOns)
    .where(eq(planAddOns.planId, planId));
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
    addOnIds: addOnRows.length ? addOnRows.map((addOn) => addOn.addOnId) : null,
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
}): Promise<PlanApi | null> {
  await db
    .insert(plans)
    .values({
      planId: plan.planId,
      derivedFromPlanId: plan.derivedFromPlanId,
      createdAt: plan.createdAt,
      deprecatedAt: plan.deprecatedAt,
      name: plan.name,
      description: plan.description,
    })
    .onConflictDoNothing();
  for (const price of plan.prices) {
    await db.insert(values).values(price.value).onConflictDoNothing();
    await db
      .insert(planPrices)
      .values({
        planId: plan.planId,
        cycleId: price.cycleId,
        valueId: price.value.valueId,
      })
      .onConflictDoNothing();
  }
  if (plan.features) {
    await db
      .insert(planFeatures)
      .values(
        plan.features.map((feature) => ({
          planId: plan.planId,
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
          planId: plan.planId,
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
  if (plan.addOnIds) {
    await db
      .insert(planAddOns)
      .values(
        plan.addOnIds.map((addOnId) => ({ planId: plan.planId, addOnId })),
      )
      .onConflictDoNothing();
  }
  return getPlan({ planId: plan.planId });
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
