import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  awardSchema,
  couponCreditsGrantedSchema,
  couponFeaturesGrantedSchema,
} from "./coupon.ts";
import { couponTemplateIdSchema } from "./ids.ts";

/** Cross-field rules for a coupon template (mirrors checkCoupon). */
export function checkCouponTemplate(
  template: {
    grantable_by_tenants: boolean;
    limit_per_granting_tenant: number | null;
    reciprocal_benefit_coupon_template: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (template.grantable_by_tenants) {
    return;
  }
  if (template.limit_per_granting_tenant !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["limit_per_granting_tenant"],
      message: "only settable when grantable_by_tenants",
    });
  }
  if (template.reciprocal_benefit_coupon_template !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["reciprocal_benefit_coupon_template"],
      message: "only settable when grantable_by_tenants",
    });
  }
}

/**
 * A reusable coupon definition (e.g. "the referral coupon"). Templates are
 * deprecated, never deleted: coupons minted from one keep their copied
 * definition.
 */
export const couponTemplateSchema = z
  .object({
    unique_id: couponTemplateIdSchema,
    created_at: epochMs,
    deprecated_at: epochMs.nullable(),
    grantable_by_tenants: z.boolean(),
    /** Only settable when grantable_by_tenants. Null means no limit. */
    limit_per_granting_tenant: z.number().int().positive().nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    default_award: awardSchema.nullable(),
    features_granted: couponFeaturesGrantedSchema,
    credits_granted: couponCreditsGrantedSchema,
    /** Only settable when grantable_by_tenants. */
    reciprocal_benefit_coupon_template: couponTemplateIdSchema.nullable(),
  })
  .superRefine(checkCouponTemplate);
export type CouponTemplate = z.infer<typeof couponTemplateSchema>;
