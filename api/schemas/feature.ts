import { z } from "zod";
import { epochMs } from "./common.ts";
import { featureIdSchema, taxTypeIdSchema } from "./ids.ts";
import { optionSchema } from "./option.ts";

export const featureSchema = z.object({
  unique_id: featureIdSchema,
  created_at: epochMs,
  deprecated_at: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  /** If options is null, this is a boolean feature. */
  options: z.array(optionSchema).min(1).nullable(),
  applicable_tax_types: z.array(taxTypeIdSchema).nullable(),
});
export type Feature = z.infer<typeof featureSchema>;
