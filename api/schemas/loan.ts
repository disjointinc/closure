import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import {
  assignmentIdSchema,
  loanIdSchema,
  loanTemplateIdSchema,
  tenantIdSchema,
} from "./ids.ts";

/** A loan tied to an assignment: the principal, the rate, and the lifecycle. */
export const loanSchema = z.object({
  loanId: loanIdSchema,
  tenantId: tenantIdSchema,
  assignmentId: assignmentIdSchema,
  createdAt: epochMs,
  closedAt: epochMs.nullable(),
  /** The template this loan's definition was copied from, if any. */
  loanTemplateId: loanTemplateIdSchema.nullable(),
  principal: currencyAmountSchema,
  interestPercentage: z.number().positive(),
});
export type Loan = z.infer<typeof loanSchema>;
