/**
 * v0/tenant/credit-grant/service.ts -- credit grant business logic. Each grant is
 * recorded in pg first (durable), then applied to the Redis balance exactly
 * once via the mgrant: marker, and finally stamped with applied_at_micros so
 * balance rebuilds can replay it. A crash anywhere in that sequence is
 * safe: the reconciler applies any grant whose applied_at_micros is still
 * NULL.
 */
import { desc, eq } from "drizzle-orm";
import {
  applyCreditGrant,
  stampGrantApplied,
} from "../../../cache/meter/index.ts";
import { db } from "../../../db/index.ts";
import { creditGrants } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { CreditGrant } from "../../../schemas/credit-grant.ts";
import type { CreditGrantCreateBody } from "./routes.ts";

// The row carries reconciler state (applied_at_micros) that isn't part of the
// wire shape, so it can't pass through directly.
function rowToCreditGrant(row: typeof creditGrants.$inferSelect): CreditGrant {
  return {
    creditGrantId: row.creditGrantId,
    meterId: row.meterId,
    grantedAt: row.grantedAt,
    byTeamMemberId: row.byTeamMemberId,
    reason: row.reason,
    amountMicrocredits: row.amountMicrocredits,
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
    .where(eq(creditGrants.tenantId, tenantId))
    .orderBy(desc(creditGrants.grantedAt));
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
  grant: CreditGrantCreateBody;
  tenantId: string;
}): Promise<CreditGrant> {
  const creditGrantId = generateId({ prefix: "credit_grant" });
  const grantedAt = Date.now();
  await db
    .insert(creditGrants)
    .values({ ...grant, creditGrantId, grantedAt, tenantId })
    .onConflictDoNothing();
  await applyCreditGrant({
    grant: {
      amount: grant.amountMicrocredits,
      creditGrantId,
      meterId: grant.meterId,
      tenantId,
    },
  });
  await stampGrantApplied({ creditGrantId });
  return { ...grant, creditGrantId, grantedAt };
}
