/**
 * v0/add-ons/service.ts -- add-on business logic. Prices accept existing
 * cycle/value ids or inline definitions. Immutable, so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { addOnFeatures, addOnPrices, addOns } from "../../db/schema.ts";
import type { AddOn } from "../../schemas/add-on.ts";
import { resolveCycleRef } from "../cycles/service.ts";
import { resolveValueRef } from "../values/service.ts";
import type { AddOnCreateBody } from "./routes.ts";

export async function getAddOn({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<AddOn | null> {
  const [row] = await db
    .select()
    .from(addOns)
    .where(eq(addOns.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const priceRows = await db
    .select()
    .from(addOnPrices)
    .where(eq(addOnPrices.addOn, uniqueId));
  const featureRows = await db
    .select()
    .from(addOnFeatures)
    .where(eq(addOnFeatures.addOn, uniqueId));
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    deprecated_at: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map((price) => ({
      cycle: price.cycle,
      value: price.value,
    })),
    features: featureRows.map((feature) => ({
      feature: feature.feature,
      set_to: feature.setTo,
    })),
  };
}

export async function listAddOns(): Promise<AddOn[]> {
  const rows = await db.select().from(addOns);
  const found = await Promise.all(
    rows.map((row) => getAddOn({ uniqueId: row.uniqueId })),
  );
  return found.filter((addOn) => addOn !== null);
}

export async function createAddOn({
  addOn,
}: {
  addOn: AddOnCreateBody;
}): Promise<AddOn | null> {
  await db
    .insert(addOns)
    .values({
      uniqueId: addOn.unique_id,
      createdAt: addOn.created_at,
      deprecatedAt: addOn.deprecated_at,
      name: addOn.name,
      description: addOn.description,
    })
    .onConflictDoNothing();
  for (const price of addOn.prices) {
    await db
      .insert(addOnPrices)
      .values({
        addOn: addOn.unique_id,
        cycle: await resolveCycleRef(price.cycle),
        value: await resolveValueRef(price.value),
      })
      .onConflictDoNothing();
  }
  await db
    .insert(addOnFeatures)
    .values(
      addOn.features.map((feature) => ({
        addOn: addOn.unique_id,
        feature: feature.feature,
        setTo: feature.set_to,
      })),
    )
    .onConflictDoNothing();
  return getAddOn({ uniqueId: addOn.unique_id });
}

/** Deprecate the add-on, or return null if no such add-on exists. */
export async function deprecateAddOn({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<AddOn | null> {
  const updated = await db
    .update(addOns)
    .set({ deprecatedAt: Date.now() })
    .where(eq(addOns.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getAddOn({ uniqueId });
}
