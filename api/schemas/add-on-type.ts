import { z } from "zod";
import { epochMs, priceSchema } from "./common.ts";
import { addOnTypeIdSchema, productLineIdSchema } from "./ids.ts";
import { planFeatureSchema } from "./plan.ts";

export const addOnTypeSchema = z.object({
  addOnTypeId: addOnTypeIdSchema,
  /** Hard lock: an add-on type extends plans in its own product line only. */
  productLineId: productLineIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  prices: z.array(priceSchema),
  features: z.array(planFeatureSchema),
});
export type AddOnType = z.infer<typeof addOnTypeSchema>;
