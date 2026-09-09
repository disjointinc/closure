/**
 * v0/feature/service.ts -- feature business logic. Options are passed
 * inline on create; features are immutable, so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { featureOptions, features, featureTaxTypes } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Feature } from "../../schemas/feature.ts";
import type { FeatureCreateBody } from "./routes.ts";

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
    productLineId: row.productLineId,
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
  feature: FeatureCreateBody;
}): Promise<Feature> {
  const featureId = generateId({ prefix: "feature" });
  const createdAt = Date.now();
  const options = feature.options
    ? feature.options.map((option) => ({
        ...option,
        featureOptionId: generateId({ prefix: "feature_option" }),
      }))
    : null;
  await db
    .insert(features)
    .values({
      featureId,
      productLineId: feature.productLineId,
      createdAt,
      deprecatedAt: null,
      name: feature.name,
      description: feature.description,
    })
    .onConflictDoNothing();
  if (options) {
    await db
      .insert(featureOptions)
      .values(options.map((option) => ({ ...option, featureId })))
      .onConflictDoNothing();
  }
  if (feature.applicableTaxTypeIds) {
    await db
      .insert(featureTaxTypes)
      .values(
        feature.applicableTaxTypeIds.map((taxTypeId) => ({
          featureId,
          taxTypeId,
        })),
      )
      .onConflictDoNothing();
  }
  return { ...feature, featureId, createdAt, deprecatedAt: null, options };
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
