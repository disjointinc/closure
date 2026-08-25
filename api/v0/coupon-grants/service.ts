/**
 * v0/coupon-grants/service.ts -- coupon grant business logic: a tenant
 * grants a coupon to another tenant, which creates the recipient's receipt.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { couponGrants, couponReceipts } from "../../db/schema.ts";
import type { CouponGrant } from "../../schemas/coupon-grant.ts";
import { generateId } from "../helpers.ts";

function rowToGrant(row: typeof couponGrants.$inferSelect): CouponGrant {
  return {
    unique_id: row.uniqueId,
    coupon: row.coupon,
    on: row.on,
    to: row.toTenant,
    used_at: row.usedAt,
    reason: row.reason,
  };
}

export async function listCouponGrants({
  tenantId,
}: {
  tenantId: string;
}): Promise<CouponGrant[]> {
  const rows = await db
    .select()
    .from(couponGrants)
    .where(eq(couponGrants.tenant, tenantId))
    .orderBy(desc(couponGrants.on));
  return rows.map(rowToGrant);
}

/** Grant the coupon to the recipient, creating their receipt. */
export async function createCouponGrant({
  grant,
  tenantId,
}: {
  grant: CouponGrant;
  tenantId: string;
}): Promise<{ receiptId: string }> {
  await db
    .insert(couponGrants)
    .values({
      uniqueId: grant.unique_id,
      tenant: tenantId,
      coupon: grant.coupon,
      on: grant.on,
      toTenant: grant.to,
      usedAt: null,
      reason: grant.reason,
    })
    .onConflictDoNothing();
  // The recipient's receipt, granted by the tenant in the path.
  const receiptId = generateId("coupon_receipt");
  await db
    .insert(couponReceipts)
    .values({
      uniqueId: receiptId,
      tenant: grant.to,
      coupon: grant.coupon,
      on: grant.on,
      usedAt: null,
      reason: null,
      grantorType: "tenant",
      byTeamMember: null,
      byTenant: tenantId,
      byCouponGrant: null,
    })
    .onConflictDoNothing();
  return { receiptId };
}
