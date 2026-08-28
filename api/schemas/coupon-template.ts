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
    grantableByTenants: boolean;
    limitPerGrantingTenant: number | null;
    reciprocalBenefitCouponTemplateId: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (template.grantableByTenants) {
    return;
  }
  if (template.limitPerGrantingTenant !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["limitPerGrantingTenant"],
      message: "only settable when grantableByTenants",
    });
  }
  if (template.reciprocalBenefitCouponTemplateId !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["reciprocalBenefitCouponTemplateId"],
      message: "only settable when grantableByTenants",
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
    couponTemplateId: couponTemplateIdSchema,
    createdAt: epochMs,
    deprecatedAt: epochMs.nullable(),
    grantableByTenants: z.boolean(),
    /** Only settable when grantableByTenants. Null means no limit. */
    limitPerGrantingTenant: z.number().int().positive().nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    defaultAward: awardSchema.nullable(),
    featuresGranted: couponFeaturesGrantedSchema,
    creditsGranted: couponCreditsGrantedSchema,
    /** Only settable when grantableByTenants. */
    reciprocalBenefitCouponTemplateId: couponTemplateIdSchema.nullable(),
  })
  .superRefine(checkCouponTemplate);
export type CouponTemplate = z.infer<typeof couponTemplateSchema>;
