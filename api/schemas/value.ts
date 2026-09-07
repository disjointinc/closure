import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import { valueIdSchema } from "./ids.ts";

/**
 * A monetary value expressed in one or more currencies, e.g.
 * { currency: "USD", unit: "cents", value: 5250 } is $52.50. Each amount is
 * an integer in that currency's smallest billable unit, and each currency
 * may appear at most once.
 */
function checkUniqueCurrencies(
  value: { amounts: { currency: string }[] },
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  value.amounts.forEach((amount, index) => {
    if (seen.has(amount.currency)) {
      ctx.addIssue({
        code: "custom",
        path: ["amounts", index, "currency"],
        message: "currencies must be unique within a value",
      });
    }
    seen.add(amount.currency);
  });
}

export const valueSchema = z
  .object({
    valueId: valueIdSchema,
    createdAt: epochMs,
    deprecatedAt: epochMs.nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    amounts: z
      .array(
        currencyAmountSchema.extend({
          value: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  .superRefine(checkUniqueCurrencies);

export type Value = z.infer<typeof valueSchema>;

/**
 * Create-input for a value: the server mints valueId and stamps createdAt;
 * a value is never created pre-deprecated.
 */
export const valueCreateSchema = z
  .object({
    name: valueSchema.shape.name,
    description: valueSchema.shape.description,
    amounts: valueSchema.shape.amounts,
  })
  .superRefine(checkUniqueCurrencies);

export type ValueCreateBody = z.infer<typeof valueCreateSchema>;
