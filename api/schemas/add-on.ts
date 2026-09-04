import { z } from "zod";
import { epochMs } from "./common.ts";
import { addOnIdSchema, addOnTypeIdSchema, assignmentIdSchema } from "./ids.ts";

/**
 * An add-on: an attach of an add-on type to an assignment for a window.
 * First-class (own surrogate id), so deletes detach this instance alone.
 */
export const addOnSchema = z.object({
  addOnId: addOnIdSchema,
  assignmentId: assignmentIdSchema,
  addOnTypeId: addOnTypeIdSchema,
  startsAt: epochMs,
  endsAt: epochMs.nullable(),
  /** Manually deleted ahead of the end, whether or not one is set. */
  deletedAt: epochMs.nullable(),
});
export type AddOn = z.infer<typeof addOnSchema>;
