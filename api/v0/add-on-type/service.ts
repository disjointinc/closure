/**
 * v0/add-on-type/service.ts -- add-on type business logic. Prices reference
 * existing cycles by id and own their values (defined inline at creation,
 * deprecated with the add-on type). Immutable, so deletes deprecate.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  addOnTypeFeatures,
  addOnTypePrices,
  addOnTypes,
  values,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { AddOnTypeApi, AddOnTypeCreateBody } from "./routes.ts";

export async function getAddOnType({
  addOnTypeId,
}: {
  addOnTypeId: string;
}): Promise<AddOnTypeApi | null> {
  const [row] = await db
    .select()
    .from(addOnTypes)
    .where(eq(addOnTypes.addOnTypeId, addOnTypeId));
  if (!row) {
    return null;
  }
  const priceRows = await db
    .select()
    .from(addOnTypePrices)
    .where(eq(addOnTypePrices.addOnTypeId, addOnTypeId));
  const featureRows = await db
    .select()
    .from(addOnTypeFeatures)
    .where(eq(addOnTypeFeatures.addOnTypeId, addOnTypeId));
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
    addOnTypeId: row.addOnTypeId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map((price) => {
      // add_on_type_prices.value_id FKs values, so the row always exists.
      const value = valueById.get(
        price.valueId,
      ) as AddOnTypeApi["prices"][0]["value"];
      return { cycleId: price.cycleId, value };
    }),
    features: featureRows.map((feature) => ({
      featureId: feature.featureId,
      setTo: feature.setTo,
    })),
  };
}

export async function listAddOnTypes(): Promise<AddOnTypeApi[]> {
  const rows = await db.select().from(addOnTypes);
  const found = await Promise.all(
    rows.map((row) => getAddOnType({ addOnTypeId: row.addOnTypeId })),
  );
  return found.filter((addOnType) => addOnType !== null);
}

export async function createAddOnType({
  addOnType,
}: {
  addOnType: AddOnTypeCreateBody;
}): Promise<AddOnTypeApi | null> {
  const addOnTypeId = generateId({ prefix: "add_on_type" });
  await db
    .insert(addOnTypes)
    .values({
      addOnTypeId,
      createdAt: Date.now(),
      deprecatedAt: null,
      name: addOnType.name,
      description: addOnType.description,
    })
    .onConflictDoNothing();
  for (const price of addOnType.prices) {
    const valueId = generateId({ prefix: "value" });
    await db
      .insert(values)
      .values({
        ...price.value,
        valueId,
        createdAt: Date.now(),
        deprecatedAt: null,
      })
      .onConflictDoNothing();
    await db
      .insert(addOnTypePrices)
      .values({
        addOnTypeId,
        cycleId: price.cycleId,
        valueId,
      })
      .onConflictDoNothing();
  }
  if (addOnType.features.length > 0) {
    await db
      .insert(addOnTypeFeatures)
      .values(
        addOnType.features.map((feature) => ({
          addOnTypeId,
          featureId: feature.featureId,
          setTo: feature.setTo,
        })),
      )
      .onConflictDoNothing();
  }
  return getAddOnType({ addOnTypeId });
}

/**
 * Deprecate the add-on type and the values its prices own, or return null if
 * no such add-on type exists. Cycles are shared and outlive the add-on type,
 * so they're left alone.
 */
export async function deprecateAddOnType({
  addOnTypeId,
}: {
  addOnTypeId: string;
}): Promise<AddOnTypeApi | null> {
  const deprecatedAt = Date.now();
  const updated = await db
    .update(addOnTypes)
    .set({ deprecatedAt })
    .where(eq(addOnTypes.addOnTypeId, addOnTypeId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  const priceRows = await db
    .select({ valueId: addOnTypePrices.valueId })
    .from(addOnTypePrices)
    .where(eq(addOnTypePrices.addOnTypeId, addOnTypeId));
  await db
    .update(values)
    .set({ deprecatedAt })
    .where(
      inArray(
        values.valueId,
        priceRows.map((price) => price.valueId),
      ),
    );
  return getAddOnType({ addOnTypeId });
}
