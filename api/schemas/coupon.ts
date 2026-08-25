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
    value: valueIdSchema,
  }),
  z.object({
    type: z.literal("flat_discount"),
    value: valueIdSchema,
  }),
  z.object({
    type: z.literal("percentage_discount"),
    value: z.number().gt(0).lte(100),
  }),
]);
export type Award = z.infer<typeof awardSchema>;

/** Awards default to a full (100%) discount when unspecified. */
export const defaultAward = {
  type: "percentage_discount",
  value: 100,
} as const;

/**
 * The features/credits a coupon (or coupon template) grants. Shared: a
 * template's definition is copied verbatim into coupons minted from it.
 */
export const couponFeaturesGrantedSchema = z
  .array(
    z.object({
      feature: featureIdSchema,
      value: featureSetTo,
      award: awardSchema.default(defaultAward),
    }),
  )
  .nullable();
export const couponCreditsGrantedSchema = z
  .array(
    z.object({
      meter: meterIdSchema,
      amount: microcredits.positive(),
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
    grantable_by_tenants: boolean;
    limit_per_granting_tenant: number | null;
    reciprocal_benefit_coupon: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (coupon.grantable_by_tenants) {
    return;
  }
  if (coupon.limit_per_granting_tenant !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["limit_per_granting_tenant"],
      message: "only settable when grantable_by_tenants",
    });
  }
  if (coupon.reciprocal_benefit_coupon !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["reciprocal_benefit_coupon"],
      message: "only settable when grantable_by_tenants",
    });
  }
}

export const couponSchema = z
  .object({
    unique_id: couponIdSchema,
    created_at: epochMs,
    /** Coupons are consumables, so they're deleted, not deprecated. */
    deleted_at: epochMs.nullable(),
    /** The template this coupon's definition was copied from, if any. */
    template: couponTemplateIdSchema.nullable(),
    grantable_by_tenants: z.boolean(),
    /** Only settable when grantable_by_tenants. Null means no limit. */
    limit_per_granting_tenant: z.number().int().positive().nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    default_award: awardSchema.nullable(),
    features_granted: couponFeaturesGrantedSchema,
    credits_granted: couponCreditsGrantedSchema,
    /** Only settable when grantable_by_tenants. */
    reciprocal_benefit_coupon: couponIdSchema.nullable(),
  })
  .superRefine(checkCoupon);
export type Coupon = z.infer<typeof couponSchema>;
