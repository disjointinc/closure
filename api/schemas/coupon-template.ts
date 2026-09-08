import { z } from "zod";
import { epochMs } from "./common.ts";
import { checkCouponGranting, couponDefinitionFields } from "./coupon.ts";
import { couponTemplateIdSchema } from "./ids.ts";

/** Cross-field rules for a coupon template (reuses the coupon check). */
export function checkCouponTemplate(
  template: {
    grantableByTenants: boolean;
    limitPerGrantingTenant: number | null;
    reciprocalBenefitCouponTemplateId: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  checkCouponGranting({
    coupon: template,
    reciprocalBenefit: {
      field: "reciprocalBenefitCouponTemplateId",
      value: template.reciprocalBenefitCouponTemplateId,
    },
    ctx,
  });
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
    ...couponDefinitionFields,
    /** Only settable when grantableByTenants. */
    reciprocalBenefitCouponTemplateId: couponTemplateIdSchema.nullable(),
  })
  .superRefine(checkCouponTemplate);
export type CouponTemplate = z.infer<typeof couponTemplateSchema>;
