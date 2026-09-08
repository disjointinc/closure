import { z } from "zod";
import { currencyAmountSchema, durationSchema, epochMs } from "./common.ts";
import {
  assignmentIdSchema,
  loanIdSchema,
  loanTemplateIdSchema,
  tenantIdSchema,
} from "./ids.ts";

/**
 * The loan's definitional fields, shared by loan templates and the API's
 * create input: the definition is copied verbatim into loans minted from
 * a template.
 */
export const loanDefinitionFields = {
  principal: currencyAmountSchema,
  interestPercentage: z.number().positive(),
  /** Fixed term: the loan is due createdAt + duration. */
  duration: durationSchema,
};

/**
 * A loan tied to the assignment that was open at creation: the principal,
 * the rate, and the lifecycle.
 */
export const loanSchema = z.object({
  loanId: loanIdSchema,
  tenantId: tenantIdSchema,
  assignmentId: assignmentIdSchema,
  createdAt: epochMs,
  closedAt: epochMs.nullable(),
  /** When repayment is due: createdAt + duration, stamped at creation. */
  endsAt: epochMs,
  /** The template this loan's definition was copied from, if any. */
  loanTemplateId: loanTemplateIdSchema.nullable(),
  ...loanDefinitionFields,
});
export type Loan = z.infer<typeof loanSchema>;
