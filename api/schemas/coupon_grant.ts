import { z } from "zod";
import { epochMs } from "./common.ts";
import { couponGrantIdSchema, couponIdSchema, tenantIdSchema } from "./ids.ts";

/** A coupon granted by a tenant to another tenant. */
export const couponGrantSchema = z.object({
  unique_id: couponGrantIdSchema,
  coupon: couponIdSchema,
  on: epochMs,
  to: tenantIdSchema,
  used_at: epochMs.nullable(),
  reason: z.string().nullable(),
});
export type CouponGrant = z.infer<typeof couponGrantSchema>;
