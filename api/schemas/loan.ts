import { z } from "zod";
import { currencyAmountSchema, durationSchema, epochMs } from "./common.ts";
import {
  assignmentIdSchema,
  loanIdSchema,
  loanTemplateIdSchema,
  tenantIdSchema,
} from "./ids.ts";
import { installmentSchema } from "./installment.ts";
import {
  annualInterestPercentageSchema,
  loanAmountSchema,
  loanDurationSchema,
  loanServicingStateSchema,
  loanServicingTermsSchema,
} from "./loan-servicing.ts";

/**
 * The loan's definitional fields, shared by loan templates and the API's
 * create input: the definition is copied verbatim into loans minted from
 * a template.
 */
export const loanDefinitionFields = {
  principal: loanAmountSchema,
  annualInterestPercentage: annualInterestPercentageSchema,
  /** Fixed term: the loan is due createdAt + duration. */
  duration: loanDurationSchema,
  servicingTerms: loanServicingTermsSchema,
};

/**
 * Principal owed by a tenant: the rate, the repayment window (endsAt), and
 * the lifecycle. Loans attach to the tenant directly; assignmentId is set
 * only when the loan funds an assignment (e.g. a BNPL plan for it), and the
 * loan's window is independent of the assignment's own.
 */
export const loanSchema = z.object({
  loanId: loanIdSchema,
  tenantId: tenantIdSchema,
  assignmentId: assignmentIdSchema.nullable(),
  createdAt: epochMs,
  closedAt: epochMs.nullable(),
  /** When repayment is due: createdAt + duration, stamped at creation. */
  endsAt: epochMs,
  deletedAt: epochMs.nullable(),
  /** The template this loan's definition was copied from, if any. */
  loanTemplateId: loanTemplateIdSchema.nullable(),
  ...loanDefinitionFields,
  // Existing definitions remain readable; stricter bounds apply at origination.
  principal: currencyAmountSchema,
  annualInterestPercentage: z.number(),
  duration: durationSchema,
  servicingTerms: loanServicingTermsSchema.nullable(),
  servicingState: loanServicingStateSchema.nullable(),
  installments: z.array(installmentSchema),
  /* Repayment obligations are computed at read time, never stored: balances
   * accrue between checkpoints and only settle on interaction. */
  due: z.array(
    z.object({ amount: z.number().int().positive(), dueAt: epochMs }),
  ),
});
export type Loan = z.infer<typeof loanSchema>;
