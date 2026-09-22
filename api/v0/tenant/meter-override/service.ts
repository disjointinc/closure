/**
 * v0/tenant/meter-override/service.ts -- team-member-applied meter overrides for
 * a tenant. Top-up prices carry their amounts inline.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { meterOverrides } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { MeterOverride } from "../../../schemas/meter-override.ts";

/**
 * The create-input override: microcredits; the server-stamped fields
 * (meterOverrideId, createdAt, tenantId) omitted.
 */
export type MeterOverrideCreateBody = Omit<
  MeterOverride,
  "meterOverrideId" | "createdAt" | "tenantId"
>;

export async function listMeterOverrides({
  tenantId,
}: {
  tenantId: string;
}): Promise<MeterOverride[]> {
  return db
    .select()
    .from(meterOverrides)
    .where(eq(meterOverrides.tenantId, tenantId))
    .orderBy(desc(meterOverrides.createdAt));
}

export async function createMeterOverride({
  override,
  tenantId,
}: {
  override: MeterOverrideCreateBody;
  tenantId: string;
}): Promise<MeterOverride> {
  const meterOverrideId = generateId({ prefix: "meter_override" });
  const createdAt = Date.now();
  const stored: MeterOverride = {
    ...override,
    meterOverrideId,
    createdAt,
    tenantId,
  };
  await db.insert(meterOverrides).values(stored).onConflictDoNothing();
  return stored;
}
