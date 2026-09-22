import { z } from "zod";
import {
  epochMs,
  featureSetTo,
  microcredits,
  priceSchema,
  resetSchedule,
} from "./common.ts";
import {
  addOnTypeIdSchema,
  featureIdSchema,
  meterIdSchema,
  planIdSchema,
  productLineIdSchema,
} from "./ids.ts";

/** A feature entry as embedded in a plan (or add-on, or feature override). */
export const planFeatureSchema = z.object({
  featureId: featureIdSchema,
  setTo: featureSetTo,
});
export type PlanFeature = z.infer<typeof planFeatureSchema>;

const topUpTierSchema = z.object({
  /**
   * Pack size (inclusive) at which this tier's per-credit prices kick in.
   * Memoryless: each purchase is priced by its own size, not by cumulative
   * spend. Must be unique across tiers and <= limitMicrocredits; both are
   * checked by the parent meter entry's refinement.
   */
  startingAtPackSizeMicrocredits: microcredits.nonnegative(),
  prices: z.array(priceSchema).min(1),
});

const topUpCreditPackSizesSchema = z.object({
  /** Each pack must be <= limitMicrocredits (checked on the parent). */
  static: z.array(microcredits.positive()).nullable(),
  dynamic: z
    .object({
      packSizeIntervalMicrocredits: microcredits.positive(),
      minimumPackSizeMicrocredits: microcredits.positive(),
      /**
       * Must be > minimumPackSizeMicrocredits and <= limitMicrocredits
       * (checked on the parent).
       */
      maximumPackSizeMicrocredits: microcredits.positive().nullable(),
    })
    .refine(
      (dynamic) =>
        dynamic.maximumPackSizeMicrocredits === null ||
        dynamic.maximumPackSizeMicrocredits >
          dynamic.minimumPackSizeMicrocredits,
      {
        message:
          "maximumPackSizeMicrocredits must be greater than minimumPackSizeMicrocredits",
        path: ["maximumPackSizeMicrocredits"],
      },
    )
    .nullable(),
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
  topUpCreditPackSizes: topUpCreditPackSizesSchema,
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
  topUpCreditPackSizes: {
    static: number[] | null;
    dynamic: { maximumPackSizeMicrocredits: number | null } | null;
  };
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
  // limitMicrocredits caps cumulative top-up purchases, so no pack-size
  // value may exceed it. Null limit means unlimited, which permits any
  // tier threshold or pack size.

  const tiers = meter.topUpPricesPerCredit;
  if (Array.isArray(tiers)) {
    const seen = new Set<number>();
    (tiers as { startingAtPackSizeMicrocredits: number }[]).forEach(
      (tier, index) => {
        if (seen.has(tier.startingAtPackSizeMicrocredits)) {
          ctx.addIssue({
            code: "custom",
            path: [
              "topUpPricesPerCredit",
              index,
              "startingAtPackSizeMicrocredits",
            ],
            message:
              "startingAtPackSizeMicrocredits values must be unique across tiers",
          });
        }
        seen.add(tier.startingAtPackSizeMicrocredits);
        if (
          meter.limitMicrocredits !== null &&
          tier.startingAtPackSizeMicrocredits > meter.limitMicrocredits
        ) {
          ctx.addIssue({
            code: "custom",
            path: [
              "topUpPricesPerCredit",
              index,
              "startingAtPackSizeMicrocredits",
            ],
            message:
              "startingAtPackSizeMicrocredits must be <= limitMicrocredits",
          });
        }
      },
    );
  }

  if (meter.limitMicrocredits !== null) {
    meter.topUpCreditPackSizes.static?.forEach((pack, index) => {
      if (
        typeof meter.limitMicrocredits === "number" &&
        pack > meter.limitMicrocredits
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["topUpCreditPackSizes", "static", index],
          message: "static pack sizes must be <= limitMicrocredits",
        });
      }
    });
  }

  if (
    meter.limitMicrocredits !== null &&
    typeof meter.topUpCreditPackSizes.dynamic?.maximumPackSizeMicrocredits ===
      "number" &&
    meter.topUpCreditPackSizes.dynamic?.maximumPackSizeMicrocredits >
      meter.limitMicrocredits
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["topUpCreditPackSizes", "dynamic", "maximumPackSizeMicrocredits"],
      message: "maximumPackSizeMicrocredits must be <= limitMicrocredits",
    });
  }
}

export const planMeterSchema = planMeterObject.superRefine(checkPlanMeter);

export const planSchema = z.object({
  planId: planIdSchema,
  /** Hard lock: a plan sells its own product line's features and meters. */
  productLineId: productLineIdSchema,
  /** The plan this version was derived from, if any. */
  derivedFromPlanId: planIdSchema.nullable(),
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  prices: z.array(priceSchema),
  features: z.array(planFeatureSchema).nullable(),
  meters: z.array(planMeterSchema).nullable(),
  addOnTypeIds: z.array(addOnTypeIdSchema).nullable(),
});
export type Plan = z.infer<typeof planSchema>;
