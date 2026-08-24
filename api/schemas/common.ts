import currencyCodes from "currency-codes";
import { z } from "zod";
import { cycleIdSchema, valueIdSchema } from "./ids.ts";

/** Milliseconds since the unix epoch. */
export const epochMs = z.number().int();

/**
 * A length of time in whole days or months, e.g. { days: 7 }, { months: 12 }.
 * Exactly one field must be non-null. Months are calendar units (a month is
 * the same day next month, clamped), not fixed day counts.
 *
 * Sub-day durations are deliberately inexpressible: windows shorter than a
 * day are rate limiting, not billing, and don't belong here.
 */
export const durationSchema = z
  .object({
    days: z.number().int().positive().nullable(),
    months: z.number().int().positive().nullable(),
  })
  .refine(
    (duration) =>
      Object.values(duration).filter((value) => value !== null).length === 1,
    {
      message: "Exactly one of days or months must be set",
    },
  );
export type Duration = z.infer<typeof durationSchema>;

/**
 * Common cryptocurrencies and stablecoins, which have no ISO 4217 code.
 * Extend as needed.
 */
const cryptoCurrencyCodes = [
  "ADA",
  "AVAX",
  "BCH",
  "BTC",
  "DAI",
  "DOGE",
  "DOT",
  "ETH",
  "LINK",
  "LTC",
  "MATIC",
  "SOL",
  "USDC",
  "USDT",
  "XRP",
];

/**
 * A currency code: any ISO 4217 alphabetic code (from the currency-codes
 * package) or a common crypto/stablecoin code, e.g. "USD", "EUR", "BTC",
 * "USDC".
 */
export const currencyCode = z.enum([
  ...currencyCodes.codes(),
  ...cryptoCurrencyCodes,
]);

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
export const resetSchedule = z.union([
  durationSchema,
  z.literal("billing_cycle_end"),
]);
