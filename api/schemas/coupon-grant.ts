import { z } from "zod";
import { epochMs } from "./common.ts";
import { couponGrantIdSchema, couponIdSchema, tenantIdSchema } from "./ids.ts";

/** A coupon granted by a tenant to another tenant. */
export const couponGrantSchema = z.object({
  couponGrantId: couponGrantIdSchema,
  couponId: couponIdSchema,
  grantedAt: epochMs,
  fromTenantId: tenantIdSchema,
  toTenantId: tenantIdSchema,
  usedAt: epochMs.nullable(),
  reason: z.string().nullable(),
});
export type CouponGrant = z.infer<typeof couponGrantSchema>;
