import { z } from "zod";
import { epochMs } from "./common.ts";
import { featureIdSchema, taxTypeIdSchema } from "./ids.ts";
import { optionSchema } from "./option.ts";

export const featureSchema = z.object({
  unique_id: featureIdSchema,
  created_at: epochMs,
  deprecated_at: epochMs.optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** If options aren't included, this is a boolean feature. */
  options: z.array(optionSchema).min(1).optional(),
  applicable_tax_types: z.array(taxTypeIdSchema).optional(),
});
export type Feature = z.infer<typeof featureSchema>;
