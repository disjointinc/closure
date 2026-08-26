/**
 * v0/tenant/coupon-receipt/service.ts -- coupon receipt business logic: a team
 * member grants a coupon to a tenant, and the tenant uses it.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { couponReceipts } from "../../../db/schema.ts";
import type { ReceiptCreateBody } from "./routes.ts";

function rowToReceipt(row: typeof couponReceipts.$inferSelect) {
  const base = {
    uniqueId: row.uniqueId,
    coupon: row.coupon,
    on: row.on,
    usedAt: row.usedAt,
    reason: row.reason,
  };
  switch (row.grantorType) {
    case "team_member":
      return { ...base, grantorType: "team_member", by: row.byTeamMember };
    case "tenant":
      return { ...base, grantorType: "tenant", by: row.byTenant };
    case "reciprocal":
      return { ...base, grantorType: "reciprocal", by: row.byCouponGrant };
  }
}

export async function listCouponReceipts({ tenantId }: { tenantId: string }) {
  const rows = await db
    .select()
    .from(couponReceipts)
    .where(eq(couponReceipts.tenant, tenantId))
    .orderBy(desc(couponReceipts.on));
  return rows.map(rowToReceipt);
}

export async function createCouponReceipt({
  receipt,
  tenantId,
}: {
  receipt: ReceiptCreateBody;
  tenantId: string;
}) {
  await db
    .insert(couponReceipts)
    .values({
      uniqueId: receipt.uniqueId,
      tenant: tenantId,
      coupon: receipt.coupon,
      on: receipt.on,
      usedAt: null,
      reason: receipt.reason,
      grantorType: "team_member",
      byTeamMember: receipt.by,
      byTenant: null,
      byCouponGrant: null,
    })
    .onConflictDoNothing();
  return { ...receipt, usedAt: null, grantorType: "team_member" as const };
}

/** Mark the receipt used, or return null if it's unknown or already used. */
export async function useCouponReceipt({
  receiptId,
  usedAt,
}: {
  receiptId: string;
  usedAt: number;
}) {
  const updated = await db
    .update(couponReceipts)
    .set({ usedAt })
    .where(
      and(
        eq(couponReceipts.uniqueId, receiptId),
        isNull(couponReceipts.usedAt),
      ),
    )
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToReceipt(updated[0]);
}
