import { z } from "zod";
import { cycleIdSchema, valueIdSchema } from "./ids.ts";

/** Milliseconds since the unix epoch. */
export const epochMs = z.number().int();

/**
 * A cron expression. Kept as an opaque string here; parsing/validation
 * belongs to whatever executes schedules.
 */
export const cron = z.string().min(1);

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

/** When credits expire or meter allocations reset. Absent means "never". */
export const resetSchedule = z.union([cron, z.literal("billing_cycle_end")]);
