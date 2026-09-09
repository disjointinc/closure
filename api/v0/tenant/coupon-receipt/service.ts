/**
 * v0/tenant/coupon-receipt/service.ts -- coupon receipt business logic: a team
 * member grants a coupon to a tenant, and the tenant uses it.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { couponReceipts } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { ReceiptCreateBody } from "./routes.ts";

function rowToReceipt(row: typeof couponReceipts.$inferSelect) {
  const base = {
    couponReceiptId: row.couponReceiptId,
    couponId: row.couponId,
    receivedAt: row.receivedAt,
    usedAt: row.usedAt,
    reason: row.reason,
  };
  switch (row.grantorType) {
    case "team_member":
      return {
        ...base,
        grantorType: "team_member",
        grantorId: row.byTeamMemberId,
      };
    case "tenant":
      return { ...base, grantorType: "tenant", grantorId: row.byTenantId };
    case "reciprocal":
      return {
        ...base,
        grantorType: "reciprocal",
        grantorId: row.byCouponGrantId,
      };
  }
}

export async function listCouponReceipts({ tenantId }: { tenantId: string }) {
  const rows = await db
    .select()
    .from(couponReceipts)
    .where(eq(couponReceipts.tenantId, tenantId))
    .orderBy(desc(couponReceipts.receivedAt));
  return rows.map(rowToReceipt);
}

export async function createCouponReceipt({
  receipt,
  tenantId,
}: {
  receipt: ReceiptCreateBody;
  tenantId: string;
}) {
  const couponReceiptId = generateId({ prefix: "coupon_receipt" });
  const receivedAt = Date.now();
  await db
    .insert(couponReceipts)
    .values({
      couponReceiptId,
      tenantId,
      couponId: receipt.couponId,
      receivedAt,
      usedAt: null,
      reason: receipt.reason,
      grantorType: "team_member",
      byTeamMemberId: receipt.grantorId,
      byTenantId: null,
      byCouponGrantId: null,
    })
    .onConflictDoNothing();
  return {
    ...receipt,
    couponReceiptId,
    receivedAt,
    usedAt: null,
    grantorType: "team_member" as const,
  };
}

/** Mark the receipt used, or return null if it's unknown or already used. */
export async function useCouponReceipt({
  couponReceiptId,
}: {
  couponReceiptId: string;
}) {
  const updated = await db
    .update(couponReceipts)
    .set({ usedAt: Date.now() })
    .where(
      and(
        eq(couponReceipts.couponReceiptId, couponReceiptId),
        isNull(couponReceipts.usedAt),
      ),
    )
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToReceipt(updated[0]);
}
