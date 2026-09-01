import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import { assignmentIdSchema, loanIdSchema, tenantIdSchema } from "./ids.ts";

/** A loan tied to an assignment. Purely a principal + lifecycle. */
export const loanSchema = z.object({
  loanId: loanIdSchema,
  tenantId: tenantIdSchema,
  assignmentId: assignmentIdSchema,
  createdAt: epochMs,
  closedAt: epochMs.nullable(),
  principal: currencyAmountSchema,
});
export type Loan = z.infer<typeof loanSchema>;
