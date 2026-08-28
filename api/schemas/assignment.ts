import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  addOnIdSchema,
  assignmentIdSchema,
  cycleIdSchema,
  experimentIdSchema,
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
  addOns: z.array(
    z.object({
      startsAt: epochMs,
      endsAt: epochMs.nullable(),
      addOnId: addOnIdSchema,
    }),
  ),
});
export type Assignment = z.infer<typeof assignmentSchema>;
