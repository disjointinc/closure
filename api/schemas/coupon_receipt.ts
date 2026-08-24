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
  unique_id: couponReceiptIdSchema,
  coupon: couponIdSchema,
  on: epochMs,
  used_at: epochMs.optional(),
  reason: z.string().optional(),
};

/** A coupon received by a tenant. "by" depends on who granted it. */
export const couponReceiptSchema = z.discriminatedUnion("grantor_type", [
  z.object({
    ...receiptFields,
    grantor_type: z.literal("team_member"),
    by: teamMemberIdSchema,
  }),
  z.object({
    ...receiptFields,
    grantor_type: z.literal("tenant"),
    by: tenantIdSchema,
  }),
  z.object({
    ...receiptFields,
    grantor_type: z.literal("reciprocal"),
    by: couponGrantIdSchema,
  }),
]);
export type CouponReceipt = z.infer<typeof couponReceiptSchema>;
