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
  uniqueId: assignmentIdSchema,
  plan: planIdSchema,
  /** Set when the assignment came from an experiment treatment. */
  experiment: experimentIdSchema.nullable(),
  cycle: cycleIdSchema,
  start: epochMs,
  end: epochMs.nullable(),
  addOns: z.array(
    z.object({
      start: epochMs,
      end: epochMs.nullable(),
      addOn: addOnIdSchema,
    }),
  ),
});
export type Assignment = z.infer<typeof assignmentSchema>;
