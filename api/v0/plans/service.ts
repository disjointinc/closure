/**
 * v0/plans/service.ts -- plan business logic. Prices (including inside meter
 * top-up tiers) accept existing cycle/value ids or inline definitions. Plans
 * are immutable and versioned (derived_from), so deletes deprecate.
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
import { resolveCycleRef, resolveValueRef } from "../helpers.ts";
import type { PlanCreateBody, PlanMeterInput } from "./routes.ts";

/** Resolve inline cycle/value refs, returning the db-ready meter entry. */
async function resolveMeter({
  meter,
}: {
  meter: PlanMeterInput;
}): Promise<PlanMeter> {
  const topUps = meter.top_up_prices_per_credit;
  if (topUps === null) {
    return { ...meter, top_up_prices_per_credit: null };
  }
  if (!Array.isArray(topUps)) {
    return {
      ...meter,
      top_up_prices_per_credit: await resolveValueRef(topUps),
    };
  }
  return {
    ...meter,
    top_up_prices_per_credit: await Promise.all(
      topUps.map(async (tier) => ({
        starting_at: tier.starting_at,
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
    unique_id: row.uniqueId,
    derived_from: row.derivedFrom,
    created_at: row.createdAt,
    deprecated_at: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map((price) => ({
      cycle: price.cycle,
      value: price.value,
    })),
    features: featureRows.length
      ? featureRows.map((feature) => ({
          feature: feature.feature,
          set_to: feature.setTo,
        }))
      : null,
    meters: meterRows.length
      ? meterRows.map((meter) => ({
          meter: meter.meter,
          default: meter.defaultMicrocredits,
          limit: meter.limitMicrocredits,
          reset: meter.reset,
          rollovers: meter.rollovers,
          top_up_prices_per_credit: meter.topUpPricesPerCredit,
          top_up_credit_pack_sizes: meter.topUpCreditPackSizes,
        }))
      : null,
    add_ons: addOnRows.length ? addOnRows.map((addOn) => addOn.addOn) : null,
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
      uniqueId: plan.unique_id,
      derivedFrom: plan.derived_from,
      createdAt: plan.created_at,
      deprecatedAt: plan.deprecated_at,
      name: plan.name,
      description: plan.description,
    })
    .onConflictDoNothing();
  for (const price of plan.prices) {
    await db
      .insert(planPrices)
      .values({
        plan: plan.unique_id,
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
          plan: plan.unique_id,
          feature: feature.feature,
          setTo: feature.set_to,
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
          plan: plan.unique_id,
          meter: resolved.meter,
          defaultMicrocredits: resolved.default,
          limitMicrocredits: resolved.limit,
          reset: resolved.reset,
          rollovers: resolved.rollovers,
          topUpPricesPerCredit: resolved.top_up_prices_per_credit,
          topUpCreditPackSizes: resolved.top_up_credit_pack_sizes,
        })
        .onConflictDoNothing();
    }
  }
  if (plan.add_ons) {
    await db
      .insert(planAddOns)
      .values(plan.add_ons.map((addOn) => ({ plan: plan.unique_id, addOn })))
      .onConflictDoNothing();
  }
  return getPlan({ uniqueId: plan.unique_id });
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
