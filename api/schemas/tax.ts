import { z } from "zod";
import { epochMs } from "./common.ts";
import { taxIdSchema, taxTypeIdSchema } from "./ids.ts";

export const taxSchema = z.object({
  unique_id: taxIdSchema,
  created_at: epochMs,
  deprecated_at: epochMs.nullable(),
  tax_type: taxTypeIdSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type Tax = z.infer<typeof taxSchema>;
