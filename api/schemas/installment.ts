import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import { installmentIdSchema, loanIdSchema } from "./ids.ts";

/** One due payment in a loan's materialized repayment schedule (BNPL). */
export const installmentSchema = z.object({
  installmentId: installmentIdSchema,
  loanId: loanIdSchema,
  createdAt: epochMs,
  dueAt: epochMs,
  amount: currencyAmountSchema.extend({
    value: currencyAmountSchema.shape.value.positive(),
  }),
  paidAt: epochMs.nullable(),
  allocatedAmount: z.number().int().nonnegative().nullable(),
  canceledAt: epochMs.nullable(),
});
export type Installment = z.infer<typeof installmentSchema>;
