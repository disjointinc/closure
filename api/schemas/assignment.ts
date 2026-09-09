import { z } from "zod";
import { addOnSchema } from "./add-on.ts";
import { epochMs } from "./common.ts";
import {
  assignmentIdSchema,
  cycleIdSchema,
  experimentIdSchema,
  planIdSchema,
  productLineIdSchema,
} from "./ids.ts";

/** A tenant's assignment to a plan for a period of time. */
export const assignmentSchema = z.object({
  assignmentId: assignmentIdSchema,
  planId: planIdSchema,
  /** Denormalized from the plan: one open assignment per tenant and line. */
  productLineId: productLineIdSchema,
  /** Set when the assignment came from an experiment treatment. */
  experimentId: experimentIdSchema.nullable(),
  cycleId: cycleIdSchema,
  createdAt: epochMs,
  startsAt: epochMs,
  endsAt: epochMs.nullable(),
  addOns: z.array(addOnSchema.omit({ assignmentId: true })),
});
export type Assignment = z.infer<typeof assignmentSchema>;
