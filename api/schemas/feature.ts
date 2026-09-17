import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  featureIdSchema,
  productLineIdSchema,
  taxTypeIdSchema,
} from "./ids.ts";
import { featureOptionSchema } from "./feature-option.ts";

export const featureSchema = z.object({
  featureId: featureIdSchema,
  /** Hard lock: a feature belongs to exactly one product line. */
  productLineId: productLineIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  /** If options is null, this is a boolean feature. */
  options: z.array(featureOptionSchema).min(1).nullable(),
  applicableTaxTypeIds: z.array(taxTypeIdSchema).min(1).nullable(),
});
export type Feature = z.infer<typeof featureSchema>;
