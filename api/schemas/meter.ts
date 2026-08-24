import { z } from "zod";
import { epochMs } from "./common.ts";
import { meterIdSchema, taxTypeIdSchema } from "./ids.ts";

export const meterSchema = z.object({
  unique_id: meterIdSchema,
  created_at: epochMs,
  deprecated_at: epochMs.optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  applicable_tax_types: z.array(taxTypeIdSchema).optional(),
});
export type Meter = z.infer<typeof meterSchema>;
