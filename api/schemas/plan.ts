import { z } from "zod";
import {
  durationSchema,
  epochMs,
  featureSetTo,
  microcredits,
  priceSchema,
  resetSchedule,
} from "./common.ts";
import {
  addOnIdSchema,
  cycleIdSchema,
  featureIdSchema,
  meterIdSchema,
  planIdSchema,
  valueIdSchema,
} from "./ids.ts";

/** A feature entry as embedded in a plan (or add-on, or feature override). */
export const planFeatureSchema = z.object({
  featureId: featureIdSchema,
  setTo: featureSetTo,
});
export type PlanFeature = z.infer<typeof planFeatureSchema>;

/** An interest-accruing price: the rate and the minimum payment per cycle. */
export const interestPriceSchema = z.object({
  cycleId: cycleIdSchema,
  interestPercentage: z.number().positive(),
  /** The minimum payment due each cycle, referencing a value by id. */
  minimumPaymentValueId: valueIdSchema,
});
export type InterestPrice = z.infer<typeof interestPriceSchema>;

const topUpTierSchema = z.object({
  /**
   * Microcredits (past the default allocation) at which this tier's prices
   * kick in. Must be unique across tiers and <= limitMicrocredits -
   * defaultMicrocredits; both are checked by the parent meter entry's
   * refinement.
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
 *
 * The microcredits-suffixed names match the db columns: bare "default" and
 * "limit" are reserved words in Postgres.
 */
export const planMeterFields = {
  meterId: meterIdSchema,
  defaultMicrocredits: microcredits.nonnegative(),
  /** Must be >= defaultMicrocredits. Null means unlimited. */
  limitMicrocredits: microcredits.positive().nullable(),
  /** Null means the allocation never resets. */
  reset: resetSchedule.nullable(),
  /** Reset periods unused credits roll over into. Null means unlimited. */
  rollovers: z.number().int().nonnegative().nullable(),
  /** Usage tiers with their own prices. */
  topUpPricesPerCredit: z.array(topUpTierSchema).min(1).nullable(),
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
  defaultMicrocredits: number;
  limitMicrocredits: number | null;
  topUpPricesPerCredit: unknown;
  topUpCreditPackSizes: { dynamic: { maximum: number | null } } | null;
}

/** Cross-field rules for a plan meter entry (also reused by meter overrides). */
export function checkPlanMeter(
  meter: PlanMeterCheckInput,
  ctx: z.RefinementCtx,
): void {
  if (
    meter.limitMicrocredits !== null &&
    meter.limitMicrocredits < meter.defaultMicrocredits
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["limitMicrocredits"],
      message: "limitMicrocredits must be >= defaultMicrocredits",
    });
  }
  // Headroom: how many microcredits above the default allocation a tenant
  // can hold. Null limit means unlimited, which permits any tier/maximum.
  // Integer arithmetic, so this difference is exact.
  const headroom =
    meter.limitMicrocredits === null
      ? null
      : meter.limitMicrocredits - meter.defaultMicrocredits;

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
      if (headroom !== null && tier.startingAt > headroom) {
        ctx.addIssue({
          code: "custom",
          path: ["topUpPricesPerCredit", index, "startingAt"],
          message:
            "startingAt must be <= limitMicrocredits - defaultMicrocredits",
        });
      }
    });
  }

  const dynamicMaximum = meter.topUpCreditPackSizes?.dynamic.maximum;
  if (
    headroom !== null &&
    typeof dynamicMaximum === "number" &&
    dynamicMaximum > headroom
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["topUpCreditPackSizes", "dynamic", "maximum"],
      message:
        "dynamic maximum must be <= limitMicrocredits - defaultMicrocredits",
    });
  }
}

export const planMeterSchema = planMeterObject.superRefine(checkPlanMeter);

export const planSchema = z.object({
  planId: planIdSchema,
  /** The plan this version was derived from, if any. */
  derivedFromPlanId: planIdSchema.nullable(),
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  /** Fixed term for loan-style plans; null means open-ended. */
  duration: durationSchema.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  prices: z.array(z.union([priceSchema, interestPriceSchema])),
  features: z.array(planFeatureSchema).nullable(),
  meters: z.array(planMeterSchema).nullable(),
  addOnIds: z.array(addOnIdSchema).nullable(),
});
export type Plan = z.infer<typeof planSchema>;
