import { z } from "zod";
import { epochMs, priceSchema } from "./common.ts";
import { addOnTypeIdSchema } from "./ids.ts";
import { planFeatureSchema } from "./plan.ts";

export const addOnTypeSchema = z.object({
  addOnTypeId: addOnTypeIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  prices: z.array(priceSchema),
  features: z.array(planFeatureSchema),
});
export type AddOnType = z.infer<typeof addOnTypeSchema>;
