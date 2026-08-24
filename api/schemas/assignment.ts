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
  unique_id: assignmentIdSchema,
  plan: planIdSchema,
  /** Set when the assignment came from an experiment treatment. */
  experiment: experimentIdSchema.optional(),
  cycle: cycleIdSchema,
  start: epochMs,
  end: epochMs.optional(),
  add_ons: z.array(
    z.object({
      start: epochMs,
      end: epochMs.optional(),
      add_on: addOnIdSchema,
    }),
  ),
});
export type Assignment = z.infer<typeof assignmentSchema>;
