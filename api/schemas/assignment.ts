import { z } from "zod";
import { currencyAmountSchema, epochMs } from "./common.ts";
import {
  addOnIdSchema,
  addOnTypeIdSchema,
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
  createdAt: epochMs,
  startsAt: epochMs,
  endsAt: epochMs.nullable(),
  /** For loan plans: the loan to auto-create, keyed by id. */
  loan: z
    .object({
      loanId: loanIdSchema,
      principal: currencyAmountSchema,
      /** Always explicit, even when copying the plan's default rate. */
      interestPercentage: z.number().positive(),
    })
    .nullable(),
  addOns: z.array(
    z.object({
      addOnId: addOnIdSchema,
      addOnTypeId: addOnTypeIdSchema,
      createdAt: epochMs,
      startsAt: epochMs,
      endsAt: epochMs.nullable(),
      /** Manually deleted ahead of the end, whether or not one is set. */
      deletedAt: epochMs.nullable(),
    }),
  ),
});
export type Assignment = z.infer<typeof assignmentSchema>;
