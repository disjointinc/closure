import { z } from "zod";
import { epochMs } from "./common.ts";
import { experimentIdSchema, planIdSchema, tenantIdSchema } from "./ids.ts";

const treatmentSchema = z.object({
  plan: planIdSchema,
  tenantPercentage: z.number().min(0).max(100),
  assignedTenants: z.array(tenantIdSchema).nullable(),
});
export type Treatment = z.infer<typeof treatmentSchema>;

export const experimentSchema = z
  .object({
    uniqueId: experimentIdSchema,
    createdAt: epochMs,
    concludedAt: epochMs.nullable(),
    planAssignmentAtConclusion: planIdSchema.nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    treatments: z.array(treatmentSchema).min(2),
  })
  .superRefine((experiment, ctx) => {
    const total = experiment.treatments.reduce(
      (sum, treatment) => sum + treatment.tenantPercentage,
      0,
    );
    if (Math.abs(total - 100) > 1e-9) {
      ctx.addIssue({
        code: "custom",
        path: ["treatments"],
        message: "treatment percentages must sum to 100",
      });
    }
  });
export type Experiment = z.infer<typeof experimentSchema>;
