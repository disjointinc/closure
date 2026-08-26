/**
 * v0/plan/service.ts -- plan business logic. Prices (including inside meter
 * top-up tiers) accept existing cycle/value ids or inline definitions. Plans
 * are immutable and versioned (derivedFrom), so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  planAddOns,
  planFeatures,
  planMeters,
  planPrices,
  plans,
} from "../../db/schema.ts";
import type { Plan, PlanMeter } from "../../schemas/plan.ts";
import { resolveCycleRef } from "../cycle/service.ts";
import { resolveValueRef } from "../value/service.ts";
import type { PlanCreateBody, PlanMeterInput } from "./routes.ts";

/** Resolve inline cycle/value refs, returning the db-ready meter entry. */
async function resolveMeter({
  meter,
}: {
  meter: PlanMeterInput;
}): Promise<PlanMeter> {
  const topUps = meter.topUpPricesPerCredit;
  if (topUps === null) {
    return { ...meter, topUpPricesPerCredit: null };
  }
  if (!Array.isArray(topUps)) {
    return {
      ...meter,
      topUpPricesPerCredit: await resolveValueRef(topUps),
    };
  }
  return {
    ...meter,
    topUpPricesPerCredit: await Promise.all(
      topUps.map(async (tier) => ({
        startingAt: tier.startingAt,
        prices: await Promise.all(
          tier.prices.map(async (price) => ({
            cycle: await resolveCycleRef(price.cycle),
            value: await resolveValueRef(price.value),
          })),
        ),
      })),
    ),
  };
}

export async function getPlan({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Plan | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(eq(plans.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const priceRows = await db
    .select()
    .from(planPrices)
    .where(eq(planPrices.plan, uniqueId));
  const featureRows = await db
    .select()
    .from(planFeatures)
    .where(eq(planFeatures.plan, uniqueId));
  const meterRows = await db
    .select()
    .from(planMeters)
    .where(eq(planMeters.plan, uniqueId));
  const addOnRows = await db
    .select()
    .from(planAddOns)
    .where(eq(planAddOns.plan, uniqueId));
  return {
    uniqueId: row.uniqueId,
    derivedFrom: row.derivedFrom,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map((price) => ({
      cycle: price.cycle,
      value: price.value,
    })),
    features: featureRows.length
      ? featureRows.map((feature) => ({
          feature: feature.feature,
          setTo: feature.setTo,
        }))
      : null,
    meters: meterRows.length
      ? meterRows.map((meter) => ({
          meter: meter.meter,
          default: meter.defaultMicrocredits,
          limit: meter.limitMicrocredits,
          reset: meter.reset,
          rollovers: meter.rollovers,
          topUpPricesPerCredit: meter.topUpPricesPerCredit,
          topUpCreditPackSizes: meter.topUpCreditPackSizes,
        }))
      : null,
    addOns: addOnRows.length ? addOnRows.map((addOn) => addOn.addOn) : null,
  };
}

export async function listPlans(): Promise<Plan[]> {
  const rows = await db.select().from(plans);
  const found = await Promise.all(
    rows.map((row) => getPlan({ uniqueId: row.uniqueId })),
  );
  return found.filter((plan) => plan !== null);
}

export async function createPlan({
  plan,
}: {
  plan: PlanCreateBody;
}): Promise<Plan | null> {
  await db
    .insert(plans)
    .values({
      uniqueId: plan.uniqueId,
      derivedFrom: plan.derivedFrom,
      createdAt: plan.createdAt,
      deprecatedAt: plan.deprecatedAt,
      name: plan.name,
      description: plan.description,
    })
    .onConflictDoNothing();
  for (const price of plan.prices) {
    await db
      .insert(planPrices)
      .values({
        plan: plan.uniqueId,
        cycle: await resolveCycleRef(price.cycle),
        value: await resolveValueRef(price.value),
      })
      .onConflictDoNothing();
  }
  if (plan.features) {
    await db
      .insert(planFeatures)
      .values(
        plan.features.map((feature) => ({
          plan: plan.uniqueId,
          feature: feature.feature,
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
          plan: plan.uniqueId,
          meter: resolved.meter,
          defaultMicrocredits: resolved.default,
          limitMicrocredits: resolved.limit,
          reset: resolved.reset,
          rollovers: resolved.rollovers,
          topUpPricesPerCredit: resolved.topUpPricesPerCredit,
          topUpCreditPackSizes: resolved.topUpCreditPackSizes,
        })
        .onConflictDoNothing();
    }
  }
  if (plan.addOns) {
    await db
      .insert(planAddOns)
      .values(plan.addOns.map((addOn) => ({ plan: plan.uniqueId, addOn })))
      .onConflictDoNothing();
  }
  return getPlan({ uniqueId: plan.uniqueId });
}

/** Deprecate the plan, or return null if no such plan exists. */
export async function deprecatePlan({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Plan | null> {
  const updated = await db
    .update(plans)
    .set({ deprecatedAt: Date.now() })
    .where(eq(plans.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getPlan({ uniqueId });
}
