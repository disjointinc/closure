import { z } from "zod";
import { currencyAmountSchema, durationSchema, epochMs } from "./common.ts";

export const MAX_LOAN_INSTALLMENTS = 1000;
export const MAX_LOAN_MONTHS = 1200;
export const MAX_LOAN_DAYS = 36600;
export const PERCENTAGE_SCALE = 1_000_000;
export const loanAmountSchema = currencyAmountSchema
  .extend({
    value: z.number().int().positive(),
  })
  .strict();

/* Decimal spelling, not floating-point multiplication, determines precision.
 * The persisted rate remains a number; calculations convert its spelling to bigint. */
export const annualInterestPercentageSchema = z
  .number()
  .min(0)
  .max(1000)
  .refine(
    (value) => /^\d+(\.\d{1,6})?$/.test(String(value)),
    "percentage must have at most six decimal places",
  );
const minimumPercentageSchema = annualInterestPercentageSchema.refine(
  (value) => value > 0 && value <= 100,
  "minimum percentage must be greater than zero and at most 100",
);
export const loanDurationSchema = durationSchema.refine(
  (value) =>
    (value.days ?? 0) <= MAX_LOAN_DAYS &&
    (value.months ?? 0) <= MAX_LOAN_MONTHS,
  "loan duration exceeds the supported 100-year range",
);

export const loanServicingTermsSchema = z
  .object({
    allocation: z.enum(["interest_first", "principal_first"]),
    interest: z
      .object({
        basis: z.enum(["original_principal", "outstanding_principal"]),
        calculation: z.literal("simple"),
        dayCount: z.enum(["actual_365", "actual_360"]),
        postMaturity: z.enum(["accrue", "stop"]),
      })
      .strict(),
    repayment: z.discriminatedUnion("type", [
      z.object({ type: z.literal("fixed_schedule") }).strict(),
      z.object({ type: z.literal("maturity_only") }).strict(),
      z
        .object({
          type: z.literal("periodic_minimum"),
          intervalMonths: z.number().int().min(1).max(MAX_LOAN_MONTHS),
          minimum: z.discriminatedUnion("type", [
            z
              .object({ type: z.literal("fixed"), amount: loanAmountSchema })
              .strict(),
            z
              .object({
                type: z.literal("balance_percentage"),
                percentage: minimumPercentageSchema,
                floor: loanAmountSchema,
              })
              .strict(),
          ]),
        })
        .strict(),
    ]),
  })
  .strict();
export type LoanServicingTerms = z.infer<typeof loanServicingTermsSchema>;

export const loanServicingStateSchema = z.object({
  principalAmount: z.number().int().nonnegative(),
  interestAmount: z.number().int().nonnegative(),
  /** Numerator remainder over (100 * PERCENTAGE_SCALE * day-count year * milliseconds per day). */
  interestCarry: z.string().regex(/^\d+$/),
  /** Last time accrual was settled; interest since then is derived on read. */
  checkpointAt: epochMs,
});
export type LoanServicingState = z.infer<typeof loanServicingStateSchema>;
