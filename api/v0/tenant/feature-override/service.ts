/**
 * v0/tenant/feature-override/service.ts -- team-member-applied feature overrides
 * for a tenant.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { featureOverrides } from "../../../db/schema.ts";
import type { FeatureOverride } from "../../../schemas/feature-override.ts";

function rowToFeatureOverride(
  row: typeof featureOverrides.$inferSelect,
): FeatureOverride {
  return {
    uniqueId: row.uniqueId,
    feature: row.feature,
    setTo: row.setTo,
    on: row.on,
    by: row.byTeamMember,
    reason: row.reason,
  };
}

export async function listFeatureOverrides({
  tenantId,
}: {
  tenantId: string;
}): Promise<FeatureOverride[]> {
  const rows = await db
    .select()
    .from(featureOverrides)
    .where(eq(featureOverrides.tenant, tenantId))
    .orderBy(desc(featureOverrides.on));
  return rows.map(rowToFeatureOverride);
}

export async function createFeatureOverride({
  override,
  tenantId,
}: {
  override: FeatureOverride;
  tenantId: string;
}): Promise<void> {
  await db
    .insert(featureOverrides)
    .values({
      uniqueId: override.uniqueId,
      tenant: tenantId,
      feature: override.feature,
      setTo: override.setTo,
      on: override.on,
      byTeamMember: override.by,
      reason: override.reason,
    })
    .onConflictDoNothing();
}
