import { z } from "zod";
import {
  durationSchema,
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

/**
 * How long an award applies once used, e.g. a flat discount for 90 days.
 * Null means no limit.
 */
const awardDuration = {
  duration: durationSchema.nullable(),
};

export const awardSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("flat_discount"),
    valueId: valueIdSchema,
    ...awardDuration,
  }),
  z.object({
    type: z.literal("flat_payout"),
    valueId: valueIdSchema,
    ...awardDuration,
  }),
  z.object({
    type: z.literal("percentage_discount"),
    percentage: z.number().gt(0).lte(100),
    ...awardDuration,
  }),
  z.object({
    type: z.literal("percentage_payout"),
    percentage: z.number().positive(),
    ...awardDuration,
  }),
]);
export type Award = z.infer<typeof awardSchema>;

/**
 * The features/credits a coupon (or coupon template) grants. Shared: a
 * template's definition is copied verbatim into coupons minted from it.
 */
export const couponFeaturesGrantedSchema = z
  .array(
    z.object({
      featureId: featureIdSchema,
      setTo: featureSetTo,
      award: awardSchema,
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
      award: awardSchema,
    }),
  )
  .nullable();

/**
 * The definition shared by coupons and coupon templates: a template's
 * definition is copied verbatim into coupons minted from it.
 */
export const couponDefinitionFields = {
  grantableByTenants: z.boolean(),
  /** Only settable when grantableByTenants. Null means no limit. */
  limitPerGrantingTenant: z.number().int().positive().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  defaultAward: awardSchema.nullable(),
  featuresGranted: couponFeaturesGrantedSchema,
  creditsGranted: couponCreditsGrantedSchema,
};

/**
 * Cross-field granting rules shared by coupons and coupon templates:
 * the limit and reciprocal benefit are only settable when tenants can
 * grant. Coupons pass reciprocalBenefitCouponId; templates pass
 * reciprocalBenefitCouponTemplateId.
 */
export function checkCouponGranting({
  coupon,
  reciprocalBenefit,
  ctx,
}: {
  coupon: {
    grantableByTenants: boolean;
    limitPerGrantingTenant: number | null;
  };
  /** The reciprocal benefit field: its name (for the issue path) and value. */
  reciprocalBenefit: { field: string; value: string | null };
  ctx: z.RefinementCtx;
}): void {
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
  if (reciprocalBenefit.value !== null) {
    ctx.addIssue({
      code: "custom",
      path: [reciprocalBenefit.field],
      message: "only settable when grantableByTenants",
    });
  }
}

/** Cross-field rules for a coupon (also reused by the API's create input). */
export function checkCoupon(
  coupon: {
    grantableByTenants: boolean;
    limitPerGrantingTenant: number | null;
    reciprocalBenefitCouponId: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  checkCouponGranting({
    coupon,
    reciprocalBenefit: {
      field: "reciprocalBenefitCouponId",
      value: coupon.reciprocalBenefitCouponId,
    },
    ctx,
  });
}

export const couponSchema = z
  .object({
    couponId: couponIdSchema,
    createdAt: epochMs,
    /** Coupons are consumables, so they're deleted, not deprecated. */
    deletedAt: epochMs.nullable(),
    /** The template this coupon's definition was copied from, if any. */
    couponTemplateId: couponTemplateIdSchema.nullable(),
    ...couponDefinitionFields,
    /** Only settable when grantableByTenants. */
    reciprocalBenefitCouponId: couponIdSchema.nullable(),
  })
  .superRefine(checkCoupon);
export type Coupon = z.infer<typeof couponSchema>;
