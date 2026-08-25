/**
 * v0/meter-overrides/service.ts -- team-member-applied meter overrides for
 * a tenant.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { meterOverrides } from "../../db/schema.ts";
import type { MeterOverride } from "../../schemas/meter-override.ts";

function rowToMeterOverride(
  row: typeof meterOverrides.$inferSelect,
): MeterOverride {
  return {
    unique_id: row.uniqueId,
    meter: row.meter,
    default: row.defaultMicrocredits,
    limit: row.limitMicrocredits,
    reset: row.reset,
    rollovers: row.rollovers,
    top_up_prices_per_credit: row.topUpPricesPerCredit,
    top_up_credit_pack_sizes: row.topUpCreditPackSizes,
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
      uniqueId: override.unique_id,
      tenant: tenantId,
      meter: override.meter,
      defaultMicrocredits: override.default,
      limitMicrocredits: override.limit,
      reset: override.reset,
      rollovers: override.rollovers,
      topUpPricesPerCredit: override.top_up_prices_per_credit,
      topUpCreditPackSizes: override.top_up_credit_pack_sizes,
      on: override.on,
      byTeamMember: override.by,
      reason: override.reason,
    })
    .onConflictDoNothing();
}
