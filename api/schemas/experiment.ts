import { z } from "zod";
import { epochMs } from "./common.ts";
import { experimentIdSchema, planIdSchema, tenantIdSchema } from "./ids.ts";

const treatmentSchema = z.object({
  plan: planIdSchema,
  tenant_percentage: z.number().min(0).max(100),
  assigned_tenants: z.array(tenantIdSchema).optional(),
});
export type Treatment = z.infer<typeof treatmentSchema>;

export const experimentSchema = z
  .object({
    unique_id: experimentIdSchema,
    created_at: epochMs,
    concluded_at: epochMs.optional(),
    plan_assignment_at_conclusion: planIdSchema.optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    treatments: z.array(treatmentSchema).min(2),
  })
  .superRefine((experiment, ctx) => {
    const total = experiment.treatments.reduce(
      (sum, treatment) => sum + treatment.tenant_percentage,
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
