/**
 * v0/tenant/coupon-grant/service.ts -- coupon grant business logic: a tenant
 * grants a coupon to another tenant, which creates the recipient's receipt.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { couponGrants, couponReceipts } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { CouponGrant } from "../../../schemas/coupon-grant.ts";
import type { CouponGrantCreateBody } from "./routes.ts";

export async function listCouponGrants({
  tenantId,
}: {
  tenantId: string;
}): Promise<CouponGrant[]> {
  return db
    .select()
    .from(couponGrants)
    .where(eq(couponGrants.fromTenantId, tenantId))
    .orderBy(desc(couponGrants.grantedAt));
}

/** Grant the coupon to the recipient, creating their receipt. */
export async function createCouponGrant({
  grant,
  tenantId,
}: {
  grant: CouponGrantCreateBody;
  tenantId: string;
}): Promise<CouponGrant> {
  const couponGrantId = generateId({ prefix: "coupon_grant" });
  const grantedAt = Date.now();
  await db
    .insert(couponGrants)
    .values({
      ...grant,
      couponGrantId,
      grantedAt,
      fromTenantId: tenantId,
      usedAt: null,
    })
    .onConflictDoNothing();
  // The recipient's receipt, granted by the tenant in the path.
  await db
    .insert(couponReceipts)
    .values({
      couponReceiptId: generateId({ prefix: "coupon_receipt" }),
      tenantId: grant.toTenantId,
      couponId: grant.couponId,
      receivedAt: grantedAt,
      usedAt: null,
      reason: null,
      grantorType: "tenant",
      byTeamMemberId: null,
      byTenantId: tenantId,
      byCouponGrantId: null,
    })
    .onConflictDoNothing();
  return {
    ...grant,
    couponGrantId,
    grantedAt,
    fromTenantId: tenantId,
    usedAt: null,
  };
}
