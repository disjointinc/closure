import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import { valueIdSchema } from "./ids.ts";

/**
 * A monetary value expressed in one or more currencies, e.g.
 * { currency: "USD", unit: "cents", value: 5250 } is $52.50. Each amount is
 * an integer in that currency's smallest billable unit, and each currency
 * may appear at most once.
 */
export const valueSchema = z
  .object({
    unique_id: valueIdSchema,
    created_at: epochMs,
    deprecated_at: epochMs.nullable(),
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
  .superRefine((value, ctx) => {
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
  });

export type Value = z.infer<typeof valueSchema>;
