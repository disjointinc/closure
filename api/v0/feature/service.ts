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
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    options: options.length
      ? options.map((option) => ({
          uniqueId: option.uniqueId,
          name: option.name,
          description: option.description,
        }))
      : null,
    applicableTaxTypes: taxTypeRows.length
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
      uniqueId: feature.uniqueId,
      createdAt: feature.createdAt,
      deprecatedAt: feature.deprecatedAt,
      name: feature.name,
      description: feature.description,
    })
    .onConflictDoNothing();
  if (feature.options) {
    await db
      .insert(featureOptions)
      .values(
        feature.options.map((option) => ({
          uniqueId: option.uniqueId,
          feature: feature.uniqueId,
          name: option.name,
          description: option.description,
        })),
      )
      .onConflictDoNothing();
  }
  if (feature.applicableTaxTypes) {
    await db
      .insert(featureTaxTypes)
      .values(
        feature.applicableTaxTypes.map((taxType) => ({
          feature: feature.uniqueId,
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
