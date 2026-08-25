/**
 * v0/tenant/credit-grant/service.ts -- credit grant business logic. Each grant is
 * recorded in pg first (durable), then applied to the Redis balance exactly
 * once via the mgrant: marker, and finally stamped with applied_at so
 * balance rebuilds can replay it. A crash anywhere in that sequence is
 * safe: the reconciler applies any grant whose applied_at is still NULL.
 */
import { desc, eq } from "drizzle-orm";
import {
  applyCreditGrant,
  stampGrantApplied,
} from "../../../cache/metering.ts";
import { db } from "../../../db/index.ts";
import { creditGrants } from "../../../db/schema.ts";
import type { CreditGrant } from "../../../schemas/credit-grant.ts";

function rowToCreditGrant(row: typeof creditGrants.$inferSelect): CreditGrant {
  return {
    unique_id: row.uniqueId,
    meter: row.meter,
    on: row.on,
    by: row.byTeamMember,
    reason: row.reason,
    amount: row.amountMicrocredits,
  };
}

export async function listCreditGrants({
  tenantId,
}: {
  tenantId: string;
}): Promise<CreditGrant[]> {
  const rows = await db
    .select()
    .from(creditGrants)
    .where(eq(creditGrants.tenant, tenantId))
    .orderBy(desc(creditGrants.on));
  return rows.map(rowToCreditGrant);
}

/**
 * Record and apply a credit grant. Throws MeterBalanceUnavailableError when
 * the balance key cannot be initialized; the durable row is already in pg,
 * so the reconciler applies the grant later.
 */
export async function createCreditGrant({
  grant,
  tenantId,
}: {
  grant: CreditGrant;
  tenantId: string;
}): Promise<void> {
  await db
    .insert(creditGrants)
    .values({
      uniqueId: grant.unique_id,
      tenant: tenantId,
      meter: grant.meter,
      on: grant.on,
      byTeamMember: grant.by,
      reason: grant.reason,
      amountMicrocredits: grant.amount,
    })
    .onConflictDoNothing();
  await applyCreditGrant({
    grant: {
      amount: grant.amount,
      meter: grant.meter,
      tenant: tenantId,
      uniqueId: grant.unique_id,
    },
  });
  await stampGrantApplied({ grantId: grant.unique_id });
}
