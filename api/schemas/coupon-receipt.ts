import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  couponGrantIdSchema,
  couponIdSchema,
  couponReceiptIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "./ids.ts";

const receiptFields = {
  uniqueId: couponReceiptIdSchema,
  coupon: couponIdSchema,
  on: epochMs,
  usedAt: epochMs.nullable(),
  reason: z.string().nullable(),
};

/** A coupon received by a tenant. "by" depends on who granted it. */
export const couponReceiptSchema = z.discriminatedUnion("grantorType", [
  z.object({
    ...receiptFields,
    grantorType: z.literal("team_member"),
    by: teamMemberIdSchema,
  }),
  z.object({
    ...receiptFields,
    grantorType: z.literal("tenant"),
    by: tenantIdSchema,
  }),
  z.object({
    ...receiptFields,
    grantorType: z.literal("reciprocal"),
    by: couponGrantIdSchema,
  }),
]);
export type CouponReceipt = z.infer<typeof couponReceiptSchema>;
