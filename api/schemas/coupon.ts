import { z } from "zod";
import {
  epochMs,
  featureSetTo,
  microcredits,
  resetSchedule,
} from "./common.ts";
import {
  couponIdSchema,
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
const defaultAward = { type: "percentage_discount", value: 100 } as const;

export const couponSchema = z
  .object({
    unique_id: couponIdSchema,
    created_at: epochMs,
    deprecated_at: epochMs.nullable(),
    grantable_by_tenants: z.boolean(),
    /** Only settable when grantable_by_tenants. Null means no limit. */
    limit_per_granting_tenant: z.number().int().positive().nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    default_award: awardSchema.nullable(),
    features_granted: z
      .array(
        z.object({
          feature: featureIdSchema,
          value: featureSetTo,
          award: awardSchema.default(defaultAward),
        }),
      )
      .nullable(),
    credits_granted: z
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
      .nullable(),
    /** Only settable when grantable_by_tenants. */
    reciprocal_benefit_coupon: couponIdSchema.nullable(),
  })
  .superRefine((coupon, ctx) => {
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
  });
export type Coupon = z.infer<typeof couponSchema>;
