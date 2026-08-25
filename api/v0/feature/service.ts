/**
 * v0/feature/service.ts -- feature business logic. Options are passed
 * inline on create; features are immutable, so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { featureOptions, features, featureTaxTypes } from "../../db/schema.ts";
import type { Feature } from "../../schemas/feature.ts";

export async function getFeature({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Feature | null> {
  const [row] = await db
    .select()
    .from(features)
    .where(eq(features.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const options = await db
    .select()
    .from(featureOptions)
    .where(eq(featureOptions.feature, uniqueId));
  const taxTypeRows = await db
    .select()
    .from(featureTaxTypes)
    .where(eq(featureTaxTypes.feature, uniqueId));
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    deprecated_at: row.deprecatedAt,
    name: row.name,
    description: row.description,
    options: options.length
      ? options.map((option) => ({
          unique_id: option.uniqueId,
          name: option.name,
          description: option.description,
        }))
      : null,
    applicable_tax_types: taxTypeRows.length
      ? taxTypeRows.map((taxType) => taxType.taxType)
      : null,
  };
}

export async function listFeatures(): Promise<Feature[]> {
  const rows = await db.select().from(features);
  const found = await Promise.all(
    rows.map((row) => getFeature({ uniqueId: row.uniqueId })),
  );
  return found.filter((feature) => feature !== null);
}

export async function createFeature({
  feature,
}: {
  feature: Feature;
}): Promise<void> {
  await db
    .insert(features)
    .values({
      uniqueId: feature.unique_id,
      createdAt: feature.created_at,
      deprecatedAt: feature.deprecated_at,
      name: feature.name,
      description: feature.description,
    })
    .onConflictDoNothing();
  if (feature.options) {
    await db
      .insert(featureOptions)
      .values(
        feature.options.map((option) => ({
          uniqueId: option.unique_id,
          feature: feature.unique_id,
          name: option.name,
          description: option.description,
        })),
      )
      .onConflictDoNothing();
  }
  if (feature.applicable_tax_types) {
    await db
      .insert(featureTaxTypes)
      .values(
        feature.applicable_tax_types.map((taxType) => ({
          feature: feature.unique_id,
          taxType,
        })),
      )
      .onConflictDoNothing();
  }
}

/** Deprecate the feature, or return null if no such feature exists. */
export async function deprecateFeature({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Feature | null> {
  const updated = await db
    .update(features)
    .set({ deprecatedAt: Date.now() })
    .where(eq(features.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getFeature({ uniqueId });
}
