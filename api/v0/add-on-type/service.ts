/**
 * v0/add-on-type/service.ts -- add-on type business logic. Prices reference
 * existing cycles by id and carry their amounts inline. Immutable, so
 * deletes deprecate.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  addOnTypeFeatures,
  addOnTypePrices,
  addOnTypes,
  features,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { AddOnType } from "../../schemas/add-on-type.ts";
import type { AddOnTypeCreateBody } from "./routes.ts";

export async function getAddOnType({
  addOnTypeId,
}: {
  addOnTypeId: string;
}): Promise<AddOnType | null> {
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
  return {
    addOnTypeId: row.addOnTypeId,
    productLineId: row.productLineId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    prices: priceRows.map((price) => ({
      cycleId: price.cycleId,
      amounts: price.amounts,
    })),
    features: featureRows.map((feature) => ({
      featureId: feature.featureId,
      setTo: feature.setTo,
    })),
  };
}

export async function listAddOnTypes(): Promise<AddOnType[]> {
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
}): Promise<AddOnType | { error: string }> {
  /* Hard lock: an add-on type extends its own line's plans, so every
   * referenced feature must belong to the same line. */
  const featureIds = addOnType.features.map((feature) => feature.featureId);
  const featureRows = featureIds.length
    ? await db
        .select()
        .from(features)
        .where(inArray(features.featureId, featureIds))
    : [];
  if (featureRows.length !== featureIds.length) {
    return { error: "a referenced feature does not exist" };
  }
  if (
    !featureRows.every((row) => row.productLineId === addOnType.productLineId)
  ) {
    return { error: "a referenced feature belongs to another product line" };
  }
  const addOnTypeId = generateId({ prefix: "add_on_type" });
  await db
    .insert(addOnTypes)
    .values({
      addOnTypeId,
      productLineId: addOnType.productLineId,
      createdAt: Date.now(),
      deprecatedAt: null,
      name: addOnType.name,
      description: addOnType.description,
    })
    .onConflictDoNothing();
  if (addOnType.prices.length > 0) {
    await db
      .insert(addOnTypePrices)
      .values(
        addOnType.prices.map((price) => ({
          addOnTypeId,
          cycleId: price.cycleId,
          amounts: price.amounts,
        })),
      )
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
  // The add-on type row always exists once its id is stored.
  return getAddOnType({ addOnTypeId }) as Promise<AddOnType>;
}

/** Deprecate the add-on type, or return null if no such add-on type exists. */
export async function deprecateAddOnType({
  addOnTypeId,
}: {
  addOnTypeId: string;
}): Promise<AddOnType | null> {
  const updated = await db
    .update(addOnTypes)
    .set({ deprecatedAt: Date.now() })
    .where(eq(addOnTypes.addOnTypeId, addOnTypeId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getAddOnType({ addOnTypeId });
}
