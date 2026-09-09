import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import { invoiceIdSchema, loanIdSchema, paymentIdSchema } from "./ids.ts";

/* Loan repayment linkage lives in a separate shape (backed by payment_loans),
 * keeping the payment row itself free of target-specific columns. Allocation
 * fields are null until the payment succeeds. */
export const paymentLoanSchema = z.object({
  loanId: loanIdSchema,
  amount: currencyAmountSchema,
  principalAmount: z.number().int().nonnegative().nullable(),
  interestAmount: z.number().int().nonnegative().nullable(),
});
export type PaymentLoan = z.infer<typeof paymentLoanSchema>;

export const paymentSchema = z.object({
  paymentId: paymentIdSchema,
  loan: paymentLoanSchema.nullable(),
  createdAt: epochMs,
  startedProcessingAt: epochMs.nullable(),
  succeededAt: epochMs.nullable(),
  failedAt: epochMs.nullable(),
  providerInternals: z.object({
    /** Payment provider, e.g. "stripe", "adyen". */
    provider: z.string().min(1),
    paymentId: z.string().min(1),
    customerId: z.string().min(1),
  }),
  invoiceIds: z.array(invoiceIdSchema),
});
export type Payment = z.infer<typeof paymentSchema>;
