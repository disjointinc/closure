import { z } from "zod";
import { epochMs } from "./common.ts";
import { taxTypeIdSchema } from "./ids.ts";

export const taxTypeSchema = z.object({
  unique_id: taxTypeIdSchema,
  created_at: epochMs,
  deprecated_at: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type TaxType = z.infer<typeof taxTypeSchema>;
