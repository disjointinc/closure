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
  couponReceiptId: couponReceiptIdSchema,
  couponId: couponIdSchema,
  receivedAt: epochMs,
  usedAt: epochMs.nullable(),
  reason: z.string().nullable(),
};

/** A coupon received by a tenant. grantorId depends on who granted it. */
export const couponReceiptSchema = z.discriminatedUnion("grantorType", [
  z.object({
    ...receiptFields,
    grantorType: z.literal("team_member"),
    grantorId: teamMemberIdSchema,
  }),
  z.object({
    ...receiptFields,
    grantorType: z.literal("tenant"),
    grantorId: tenantIdSchema,
  }),
  z.object({
    ...receiptFields,
    grantorType: z.literal("reciprocal"),
    grantorId: couponGrantIdSchema,
  }),
]);
export type CouponReceipt = z.infer<typeof couponReceiptSchema>;
