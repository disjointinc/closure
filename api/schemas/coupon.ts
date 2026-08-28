import { z } from "zod";
import {
  epochMs,
  featureSetTo,
  microcredits,
  resetSchedule,
} from "./common.ts";
import {
  couponIdSchema,
  couponTemplateIdSchema,
  featureIdSchema,
  meterIdSchema,
  valueIdSchema,
} from "./ids.ts";

export const awardSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("payout"),
    valueId: valueIdSchema,
  }),
  z.object({
    type: z.literal("flat_discount"),
    valueId: valueIdSchema,
  }),
  z.object({
    type: z.literal("percentage_discount"),
    percentage: z.number().gt(0).lte(100),
  }),
]);
export type Award = z.infer<typeof awardSchema>;

/** Awards default to a full (100%) discount when unspecified. */
export const defaultAward = {
  type: "percentage_discount",
  percentage: 100,
} as const;

/**
 * The features/credits a coupon (or coupon template) grants. Shared: a
 * template's definition is copied verbatim into coupons minted from it.
 */
export const couponFeaturesGrantedSchema = z
  .array(
    z.object({
      featureId: featureIdSchema,
      setTo: featureSetTo,
      award: awardSchema.default(defaultAward),
    }),
  )
  .nullable();
export const couponCreditsGrantedSchema = z
  .array(
    z.object({
      meterId: meterIdSchema,
      amountMicrocredits: microcredits.positive(),
      /** Null means the credits never expire. */
      expiration: resetSchedule.nullable(),
      /** Null means unlimited rollovers. */
      rollovers: z.number().int().nonnegative().nullable(),
      award: awardSchema.default(defaultAward),
    }),
  )
  .nullable();

/** Cross-field rules for a coupon (also reused by the API's create input). */
export function checkCoupon(
  coupon: {
    grantableByTenants: boolean;
    limitPerGrantingTenant: number | null;
    reciprocalBenefitCouponId: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (coupon.grantableByTenants) {
    return;
  }
  if (coupon.limitPerGrantingTenant !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["limitPerGrantingTenant"],
      message: "only settable when grantableByTenants",
    });
  }
  if (coupon.reciprocalBenefitCouponId !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["reciprocalBenefitCouponId"],
      message: "only settable when grantableByTenants",
    });
  }
}

export const couponSchema = z
  .object({
    couponId: couponIdSchema,
    createdAt: epochMs,
    /** Coupons are consumables, so they're deleted, not deprecated. */
    deletedAt: epochMs.nullable(),
    /** The template this coupon's definition was copied from, if any. */
    templateId: couponTemplateIdSchema.nullable(),
    grantableByTenants: z.boolean(),
    /** Only settable when grantableByTenants. Null means no limit. */
    limitPerGrantingTenant: z.number().int().positive().nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    defaultAward: awardSchema.nullable(),
    featuresGranted: couponFeaturesGrantedSchema,
    creditsGranted: couponCreditsGrantedSchema,
    /** Only settable when grantableByTenants. */
    reciprocalBenefitCouponId: couponIdSchema.nullable(),
  })
  .superRefine(checkCoupon);
export type Coupon = z.infer<typeof couponSchema>;
