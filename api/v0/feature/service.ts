/**
 * v0/feature/service.ts -- feature business logic. Options are passed
 * inline on create; features are immutable, so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { featureOptions, features, featureTaxTypes } from "../../db/schema.ts";
import type { Feature } from "../../schemas/feature.ts";

export async function getFeature({
  featureId,
}: {
  featureId: string;
}): Promise<Feature | null> {
  const [row] = await db
    .select()
    .from(features)
    .where(eq(features.featureId, featureId));
  if (!row) {
    return null;
  }
  const options = await db
    .select()
    .from(featureOptions)
    .where(eq(featureOptions.featureId, featureId));
  const taxTypeRows = await db
    .select()
    .from(featureTaxTypes)
    .where(eq(featureTaxTypes.featureId, featureId));
  return {
    featureId: row.featureId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    options: options.length
      ? options.map((option) => ({
          featureOptionId: option.featureOptionId,
          name: option.name,
          description: option.description,
        }))
      : null,
    applicableTaxTypeIds: taxTypeRows.length
      ? taxTypeRows.map((taxType) => taxType.taxTypeId)
      : null,
  };
}

export async function listFeatures(): Promise<Feature[]> {
  const rows = await db.select().from(features);
  const found = await Promise.all(
    rows.map((row) => getFeature({ featureId: row.featureId })),
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
      featureId: feature.featureId,
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
          featureOptionId: option.featureOptionId,
          featureId: feature.featureId,
          name: option.name,
          description: option.description,
        })),
      )
      .onConflictDoNothing();
  }
  if (feature.applicableTaxTypeIds) {
    await db
      .insert(featureTaxTypes)
      .values(
        feature.applicableTaxTypeIds.map((taxTypeId) => ({
          featureId: feature.featureId,
          taxTypeId,
        })),
      )
      .onConflictDoNothing();
  }
}

/** Deprecate the feature, or return null if no such feature exists. */
export async function deprecateFeature({
  featureId,
}: {
  featureId: string;
}): Promise<Feature | null> {
  const updated = await db
    .update(features)
    .set({ deprecatedAt: Date.now() })
    .where(eq(features.featureId, featureId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getFeature({ featureId });
}
