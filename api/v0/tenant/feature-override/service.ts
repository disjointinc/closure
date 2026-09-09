/**
 * v0/tenant/feature-override/service.ts -- team-member-applied feature overrides
 * for a tenant.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { featureOverrides } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { FeatureOverride } from "../../../schemas/feature-override.ts";
import type { FeatureOverrideCreateBody } from "./routes.ts";

export async function listFeatureOverrides({
  tenantId,
}: {
  tenantId: string;
}): Promise<FeatureOverride[]> {
  return db
    .select()
    .from(featureOverrides)
    .where(eq(featureOverrides.tenantId, tenantId))
    .orderBy(desc(featureOverrides.createdAt));
}

export async function createFeatureOverride({
  override,
  tenantId,
}: {
  override: FeatureOverrideCreateBody;
  tenantId: string;
}): Promise<FeatureOverride> {
  const featureOverrideId = generateId({ prefix: "feature_override" });
  const createdAt = Date.now();
  await db
    .insert(featureOverrides)
    .values({ ...override, featureOverrideId, createdAt, tenantId })
    .onConflictDoNothing();
  return { ...override, featureOverrideId, createdAt, tenantId };
}
