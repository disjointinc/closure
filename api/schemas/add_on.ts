import { z } from "zod";
import { epochMs, priceSchema } from "./common.ts";
import { addOnIdSchema } from "./ids.ts";
import { planFeatureSchema } from "./plan.ts";

export const addOnSchema = z.object({
  unique_id: addOnIdSchema,
  created_at: epochMs,
  deprecated_at: epochMs.optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  prices: z.array(priceSchema),
  features: z.array(planFeatureSchema),
});
export type AddOn = z.infer<typeof addOnSchema>;
