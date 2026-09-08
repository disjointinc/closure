import { z } from "zod";
import { addOnSchema } from "./add-on.ts";
import { epochMs } from "./common.ts";
import {
  assignmentIdSchema,
  cycleIdSchema,
  experimentIdSchema,
  planIdSchema,
} from "./ids.ts";
import { loanSchema } from "./loan.ts";

/** A tenant's assignment to a plan for a period of time. */
export const assignmentSchema = z.object({
  assignmentId: assignmentIdSchema,
  planId: planIdSchema,
  /** Set when the assignment came from an experiment treatment. */
  experimentId: experimentIdSchema.nullable(),
  cycleId: cycleIdSchema,
  createdAt: epochMs,
  startsAt: epochMs,
  endsAt: epochMs.nullable(),
  /**
   * For loan plans: the loan to auto-create, keyed by id. The rate is
   * always explicit, even when copying the plan's default rate.
   */
  loan: loanSchema
    .pick({ loanId: true, principal: true, interestPercentage: true })
    .nullable(),
  addOns: z.array(addOnSchema.omit({ assignmentId: true })),
});
export type Assignment = z.infer<typeof assignmentSchema>;
