/**
 * v0/tenant/meter-override/service.ts -- team-member-applied meter overrides for
 * a tenant.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { meterOverrides } from "../../../db/schema.ts";
import type { MeterOverride } from "../../../schemas/meter-override.ts";

function rowToMeterOverride(
  row: typeof meterOverrides.$inferSelect,
): MeterOverride {
  return {
    uniqueId: row.uniqueId,
    meter: row.meter,
    default: row.defaultMicrocredits,
    limit: row.limitMicrocredits,
    reset: row.reset,
    rollovers: row.rollovers,
    topUpPricesPerCredit: row.topUpPricesPerCredit,
    topUpCreditPackSizes: row.topUpCreditPackSizes,
    on: row.on,
    by: row.byTeamMember,
    reason: row.reason,
  };
}

export async function listMeterOverrides({
  tenantId,
}: {
  tenantId: string;
}): Promise<MeterOverride[]> {
  const rows = await db
    .select()
    .from(meterOverrides)
    .where(eq(meterOverrides.tenant, tenantId))
    .orderBy(desc(meterOverrides.on));
  return rows.map(rowToMeterOverride);
}

export async function createMeterOverride({
  override,
  tenantId,
}: {
  override: MeterOverride;
  tenantId: string;
}): Promise<void> {
  await db
    .insert(meterOverrides)
    .values({
      uniqueId: override.uniqueId,
      tenant: tenantId,
      meter: override.meter,
      defaultMicrocredits: override.default,
      limitMicrocredits: override.limit,
      reset: override.reset,
      rollovers: override.rollovers,
      topUpPricesPerCredit: override.topUpPricesPerCredit,
      topUpCreditPackSizes: override.topUpCreditPackSizes,
      on: override.on,
      byTeamMember: override.by,
      reason: override.reason,
    })
    .onConflictDoNothing();
}
