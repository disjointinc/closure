import { z } from "zod";
import { epochMs, priceSchema } from "./common.ts";
import { addOnIdSchema } from "./ids.ts";
import { planFeatureSchema } from "./plan.ts";

export const addOnSchema = z.object({
  uniqueId: addOnIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  prices: z.array(priceSchema),
  features: z.array(planFeatureSchema),
});
export type AddOn = z.infer<typeof addOnSchema>;
