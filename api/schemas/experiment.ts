import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  experimentIdSchema,
  planIdSchema,
  productLineIdSchema,
} from "./ids.ts";
import { treatmentSchema } from "./treatment.ts";

/**
 * Concluding-plan outcome that leaves the tenant's current assignment in the
 * line as-is (re-anchored only when a synchronized sibling line changes).
 */
export const PRESERVE_CONCLUDING_PLAN = "preserve";

const concludingPlanSchema = z.object({
  productLineId: productLineIdSchema,
  /* Null ends the tenant's assignment in the line with no replacement;
   * PRESERVE_CONCLUDING_PLAN keeps it. */
  planId: z
    .union([planIdSchema, z.literal(PRESERVE_CONCLUDING_PLAN)])
    .nullable(),
});

export const experimentSchema = z.object({
  experimentId: experimentIdSchema,
  createdAt: epochMs,
  concludedAt: epochMs.nullable(),
  concludingPlans: z.array(concludingPlanSchema).nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  treatments: z.array(treatmentSchema).min(2),
});
export type Experiment = z.infer<typeof experimentSchema>;
