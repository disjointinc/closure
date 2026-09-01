import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import {
  addOnIdSchema,
  assignmentIdSchema,
  cycleIdSchema,
  experimentIdSchema,
  loanIdSchema,
  planIdSchema,
} from "./ids.ts";

/** A tenant's assignment to a plan for a period of time. */
export const assignmentSchema = z.object({
  assignmentId: assignmentIdSchema,
  planId: planIdSchema,
  /** Set when the assignment came from an experiment treatment. */
  experimentId: experimentIdSchema.nullable(),
  cycleId: cycleIdSchema,
  startsAt: epochMs,
  endsAt: epochMs.nullable(),
  /** For interest-accruing plans: the loan to auto-create, keyed by id. */
  loan: z
    .object({
      loanId: loanIdSchema,
      principal: currencyAmountSchema,
    })
    .nullable(),
  addOns: z.array(
    z.object({
      startsAt: epochMs,
      endsAt: epochMs.nullable(),
      addOnId: addOnIdSchema,
    }),
  ),
});
export type Assignment = z.infer<typeof assignmentSchema>;
