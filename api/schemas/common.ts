import { z } from "zod";
import { cycleIdSchema, valueIdSchema } from "./ids.ts";

/** Milliseconds since the unix epoch. */
export const epochMs = z.number().int();

/**
 * A standard five-field cron expression: "minute hour day-of-month month
 * day-of-week", e.g. "* * * 5 *". Fields are numeric, supporting "*",
 * lists ("1,2,3"), ranges ("1-5"), and steps ("*\/5", "0-30/5").
 */
const cronFieldRanges = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
] as const;

function isValidCronField(field: string, min: number, max: number): boolean {
  return field.split(",").every((part) => {
    const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!match) {
      return false;
    }
    const [, start, end, step] = match;
    if (step !== undefined && Number(step) < 1) {
      return false;
    }
    if (start !== "*") {
      const value = Number(start);
      if (value < min || value > max) {
        return false;
      }
    }
    if (end !== undefined) {
      // "*-5" is not valid; a range needs a numeric start <= end, in bounds.
      if (start === "*") {
        return false;
      }
      const value = Number(end);
      if (value < min || value > max || value < Number(start)) {
        return false;
      }
    }
    return true;
  });
}

export const cron = z.string().superRefine((value, ctx) => {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) {
    ctx.addIssue({
      code: "custom",
      message: "expected 5 fields: minute hour day-of-month month day-of-week",
    });
    return;
  }
  fields.forEach((field, index) => {
    const { name, min, max } = cronFieldRanges[index];
    if (!isValidCronField(field, min, max)) {
      ctx.addIssue({
        code: "custom",
        message: `invalid ${name} field ${JSON.stringify(field)}: use ${min}-${max}, "*", lists, ranges, steps`,
      });
    }
  });
});

/** ISO 4217-style currency code, e.g. "USD". */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/**
 * Credit quantities are integer microcredits (1 credit = 1e6 microcredits),
 * so equality and comparison are exact -- no floating point. Refine with
 * .positive() / .nonnegative() at each usage site.
 */
export const microcredits = z.number().int();

/**
 * A monetary amount in a currency's smallest billable unit, e.g.
 * { currency: "USD", unit: "cents", value: 5250 } is $52.50. Integer-only,
 * so equality and comparison are exact. Refine value's sign (e.g.
 * .positive()) at each usage site.
 */
export const currencyAmountSchema = z.object({
  currency: currencyCode,
  /** Name of the smallest billable unit, e.g. "cents" for USD. */
  unit: z.string().min(1),
  value: z.number().int(),
});
export type CurrencyAmount = z.infer<typeof currencyAmountSchema>;

/**
 * What a feature is set to: a boolean for on/off features, or the list of
 * enabled options for enumerated features.
 */
export const featureSetTo = z.union([z.boolean(), z.array(z.string())]);

/** A price: the value charged per cycle. No id of its own. */
export const priceSchema = z.object({
  cycle: cycleIdSchema,
  value: valueIdSchema,
});
export type Price = z.infer<typeof priceSchema>;

/** When credits expire or meter allocations reset. Null means "never". */
export const resetSchedule = z.union([cron, z.literal("billing_cycle_end")]);
