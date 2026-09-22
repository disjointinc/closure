import { z } from "zod";
import { planIdSchema, tenantIdSchema, treatmentIdSchema } from "./ids.ts";

/** An embedded experiment bucket with at most one plan per product line. */
export const treatmentSchema = z.object({
  treatmentId: treatmentIdSchema,
  planIds: z.array(planIdSchema).min(1),
  tenantPercentage: z.number().min(0).max(100),
  assignedTenantIds: z.array(tenantIdSchema),
});
export type Treatment = z.infer<typeof treatmentSchema>;
