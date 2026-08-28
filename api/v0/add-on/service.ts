/**
 * v0/add-on/service.ts -- add-on business logic. Prices reference existing
 * cycles by id and own their values (defined inline at creation, deprecated
 * with the add-on). Immutable, so deletes deprecate.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { addOnFeatures, addOnPrices, addOns, values } from "../../db/schema.ts";
import type { AddOn } from "../../schemas/add-on.ts";
import type { AddOnCreateBody } from "./routes.ts";

export async function getAddOn({
  addOnId,
}: {
  addOnId: string;
}): Promise<AddOn | null> {
  const [row] = await db
    .select()
    .from(addOns)
    .where(eq(addOns.addOnId, addOnId));
  if (!row) {
    return null;
  }
  const priceRows = await db
    .select()
    .from(addOnPrices)
    .where(eq(addOnPrices.addOnId, addOnId));
  const featureRows = await db
    .select()
    .from(addOnFeatures)
    .where(eq(addOnFeatures.addOnId, addOnId));
  const valueRows = await db
    .select()
    .from(values)
    .where(
      inArray(
        values.valueId,
        priceRows.map((price) => price.valueId),
      ),
    );
  const valueById = new Map(valueRows.map((value) => [value.valueId, value]));
  return {
    addOnId: row.addOnId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map((price) => {
      // add_on_prices.value_id FKs values, so the row always exists.
      const value = valueById.get(price.valueId) as AddOn["prices"][0]["value"];
      return { cycleId: price.cycleId, value };
    }),
    features: featureRows.map((feature) => ({
      featureId: feature.featureId,
      setTo: feature.setTo,
    })),
  };
}

export async function listAddOns(): Promise<AddOn[]> {
  const rows = await db.select().from(addOns);
  const found = await Promise.all(
    rows.map((row) => getAddOn({ addOnId: row.addOnId })),
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
      addOnId: addOn.addOnId,
      createdAt: addOn.createdAt,
      deprecatedAt: addOn.deprecatedAt,
      name: addOn.name,
      description: addOn.description,
    })
    .onConflictDoNothing();
  for (const price of addOn.prices) {
    await db.insert(values).values(price.value).onConflictDoNothing();
    await db
      .insert(addOnPrices)
      .values({
        addOnId: addOn.addOnId,
        cycleId: price.cycleId,
        valueId: price.value.valueId,
      })
      .onConflictDoNothing();
  }
  await db
    .insert(addOnFeatures)
    .values(
      addOn.features.map((feature) => ({
        addOnId: addOn.addOnId,
        featureId: feature.featureId,
        setTo: feature.setTo,
      })),
    )
    .onConflictDoNothing();
  return getAddOn({ addOnId: addOn.addOnId });
}

/**
 * Deprecate the add-on and the values its prices own, or return null if no
 * such add-on exists. Cycles are shared and outlive the add-on, so they're
 * left alone.
 */
export async function deprecateAddOn({
  addOnId,
}: {
  addOnId: string;
}): Promise<AddOn | null> {
  const deprecatedAt = Date.now();
  const updated = await db
    .update(addOns)
    .set({ deprecatedAt })
    .where(eq(addOns.addOnId, addOnId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  const priceRows = await db
    .select({ valueId: addOnPrices.valueId })
    .from(addOnPrices)
    .where(eq(addOnPrices.addOnId, addOnId));
  await db
    .update(values)
    .set({ deprecatedAt })
    .where(
      inArray(
        values.valueId,
        priceRows.map((price) => price.valueId),
      ),
    );
  return getAddOn({ addOnId });
}
