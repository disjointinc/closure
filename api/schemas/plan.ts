import { z } from "zod";
import {
  epochMs,
  featureSetTo,
  microcredits,
  priceSchema,
  resetSchedule,
} from "./common.ts";
import {
  addOnIdSchema,
  featureIdSchema,
  meterIdSchema,
  planIdSchema,
  valueIdSchema,
} from "./ids.ts";

/** A feature entry as embedded in a plan (or add-on, or feature override). */
export const planFeatureSchema = z.object({
  feature: featureIdSchema,
  set_to: featureSetTo,
});
export type PlanFeature = z.infer<typeof planFeatureSchema>;

const topUpTierSchema = z.object({
  /**
   * Microcredits (past the default allocation) at which this tier's prices
   * kick in. Must be unique across tiers and <= limit - default; both are
   * checked by the parent meter entry's refinement.
   */
  starting_at: microcredits.positive(),
  prices: z.array(priceSchema).min(1),
});

const topUpCreditPackSizesSchema = z.object({
  static: z.array(microcredits.positive()),
  dynamic: z
    .object({
      interval: microcredits.positive(),
      minimum: microcredits.positive(),
      /** Must be > minimum and <= limit - default (checked on the parent). */
      maximum: microcredits.positive().optional(),
    })
    .refine(
      (dynamic) =>
        dynamic.maximum === undefined || dynamic.maximum > dynamic.minimum,
      {
        message: "maximum must be greater than minimum",
        path: ["maximum"],
      },
    ),
});

/**
 * A meter entry as embedded in a plan (or meter override). Exported as a
 * plain fields object so related schemas (e.g. meter_override) can rebuild
 * the object with extra fields and re-apply the same refinement.
 */
export const planMeterFields = {
  meter: meterIdSchema,
  default: microcredits.nonnegative(),
  /** Must be >= default. Absent means unlimited. */
  limit: microcredits.positive().optional(),
  /** Absent means the allocation never resets. */
  reset: resetSchedule.optional(),
  /** Reset periods unused credits roll over into. Absent means unlimited. */
  rollovers: z.number().int().nonnegative().optional(),
  /** A flat per-credit value, or usage tiers with their own prices. */
  top_up_prices_per_credit: z
    .union([valueIdSchema, z.array(topUpTierSchema).min(1)])
    .optional(),
  top_up_credit_pack_sizes: topUpCreditPackSizesSchema.optional(),
};

const planMeterObject = z.object(planMeterFields);
export type PlanMeter = z.infer<typeof planMeterObject>;

/** Cross-field rules for a plan meter entry (also reused by meter overrides). */
export function checkPlanMeter(meter: PlanMeter, ctx: z.RefinementCtx): void {
  if (meter.limit !== undefined && meter.limit < meter.default) {
    ctx.addIssue({
      code: "custom",
      path: ["limit"],
      message: "limit must be >= default",
    });
  }
  // Headroom: how many microcredits above the default allocation a tenant
  // can hold. Undefined limit means unlimited, which permits any
  // tier/maximum. Integer arithmetic, so this difference is exact.
  const headroom =
    meter.limit === undefined ? undefined : meter.limit - meter.default;

  const tiers = meter.top_up_prices_per_credit;
  if (Array.isArray(tiers)) {
    const seen = new Set<number>();
    tiers.forEach((tier, index) => {
      if (seen.has(tier.starting_at)) {
        ctx.addIssue({
          code: "custom",
          path: ["top_up_prices_per_credit", index, "starting_at"],
          message: "starting_at values must be unique across tiers",
        });
      }
      seen.add(tier.starting_at);
      if (headroom !== undefined && tier.starting_at > headroom) {
        ctx.addIssue({
          code: "custom",
          path: ["top_up_prices_per_credit", index, "starting_at"],
          message: "starting_at must be <= limit - default",
        });
      }
    });
  }

  const dynamicMaximum = meter.top_up_credit_pack_sizes?.dynamic.maximum;
  if (
    headroom !== undefined &&
    dynamicMaximum !== undefined &&
    dynamicMaximum > headroom
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["top_up_credit_pack_sizes", "dynamic", "maximum"],
      message: "dynamic maximum must be <= limit - default",
    });
  }
}

export const planMeterSchema = planMeterObject.superRefine(checkPlanMeter);

export const planSchema = z.object({
  unique_id: planIdSchema,
  /** The plan this version was derived from, if any. */
  derived_from: planIdSchema.optional(),
  created_at: epochMs,
  deprecated_at: epochMs.optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  prices: z.array(priceSchema),
  features: z.array(planFeatureSchema).optional(),
  meters: z.array(planMeterSchema).optional(),
  add_ons: z.array(addOnIdSchema).optional(),
});
export type Plan = z.infer<typeof planSchema>;
