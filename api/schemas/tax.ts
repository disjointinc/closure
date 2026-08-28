import { z } from "zod";
import { epochMs } from "./common.ts";
import { taxIdSchema, taxTypeIdSchema } from "./ids.ts";

export const taxSchema = z.object({
  taxId: taxIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  taxTypeId: taxTypeIdSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type Tax = z.infer<typeof taxSchema>;
