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
  setTo: featureSetTo,
});
export type PlanFeature = z.infer<typeof planFeatureSchema>;

const topUpTierSchema = z.object({
  /**
   * Microcredits (past the default allocation) at which this tier's prices
   * kick in. Must be unique across tiers and <= limit - default; both are
   * checked by the parent meter entry's refinement.
   */
  startingAt: microcredits.positive(),
  prices: z.array(priceSchema).min(1),
});

const topUpCreditPackSizesSchema = z.object({
  static: z.array(microcredits.positive()),
  dynamic: z
    .object({
      interval: microcredits.positive(),
      minimum: microcredits.positive(),
      /** Must be > minimum and <= limit - default (checked on the parent). */
      maximum: microcredits.positive().nullable(),
    })
    .refine(
      (dynamic) =>
        dynamic.maximum === null || dynamic.maximum > dynamic.minimum,
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
  /** Must be >= default. Null means unlimited. */
  limit: microcredits.positive().nullable(),
  /** Null means the allocation never resets. */
  reset: resetSchedule.nullable(),
  /** Reset periods unused credits roll over into. Null means unlimited. */
  rollovers: z.number().int().nonnegative().nullable(),
  /** A flat per-credit value, or usage tiers with their own prices. */
  topUpPricesPerCredit: z
    .union([valueIdSchema, z.array(topUpTierSchema).min(1)])
    .nullable(),
  topUpCreditPackSizes: topUpCreditPackSizesSchema.nullable(),
};

const planMeterObject = z.object(planMeterFields);
export type PlanMeter = z.infer<typeof planMeterObject>;

/**
 * The subset of a plan meter entry the cross-field checks read. Structural
 * (rather than PlanMeter) so the API's create input -- where value refs may
 * still be inline objects -- can reuse the same check.
 */
export interface PlanMeterCheckInput {
  default: number;
  limit: number | null;
  topUpPricesPerCredit: unknown;
  topUpCreditPackSizes: { dynamic: { maximum: number | null } } | null;
}

/** Cross-field rules for a plan meter entry (also reused by meter overrides). */
export function checkPlanMeter(
  meter: PlanMeterCheckInput,
  ctx: z.RefinementCtx,
): void {
  if (meter.limit !== null && meter.limit < meter.default) {
    ctx.addIssue({
      code: "custom",
      path: ["limit"],
      message: "limit must be >= default",
    });
  }
  // Headroom: how many microcredits above the default allocation a tenant
  // can hold. Null limit means unlimited, which permits any tier/maximum.
  // Integer arithmetic, so this difference is exact.
  const headroom =
    meter.limit === null ? undefined : meter.limit - meter.default;

  const tiers = meter.topUpPricesPerCredit;
  if (Array.isArray(tiers)) {
    const seen = new Set<number>();
    (tiers as { startingAt: number }[]).forEach((tier, index) => {
      if (seen.has(tier.startingAt)) {
        ctx.addIssue({
          code: "custom",
          path: ["topUpPricesPerCredit", index, "startingAt"],
          message: "startingAt values must be unique across tiers",
        });
      }
      seen.add(tier.startingAt);
      if (headroom !== undefined && tier.startingAt > headroom) {
        ctx.addIssue({
          code: "custom",
          path: ["topUpPricesPerCredit", index, "startingAt"],
          message: "startingAt must be <= limit - default",
        });
      }
    });
  }

  const dynamicMaximum = meter.topUpCreditPackSizes?.dynamic.maximum;
  if (
    headroom !== undefined &&
    typeof dynamicMaximum === "number" &&
    dynamicMaximum > headroom
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["topUpCreditPackSizes", "dynamic", "maximum"],
      message: "dynamic maximum must be <= limit - default",
    });
  }
}

export const planMeterSchema = planMeterObject.superRefine(checkPlanMeter);

export const planSchema = z.object({
  uniqueId: planIdSchema,
  /** The plan this version was derived from, if any. */
  derivedFrom: planIdSchema.nullable(),
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  prices: z.array(priceSchema),
  features: z.array(planFeatureSchema).nullable(),
  meters: z.array(planMeterSchema).nullable(),
  addOns: z.array(addOnIdSchema).nullable(),
});
export type Plan = z.infer<typeof planSchema>;
