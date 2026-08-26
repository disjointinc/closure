import { z } from "zod";
import { epochMs } from "./common.ts";
import { meterIdSchema, taxTypeIdSchema } from "./ids.ts";

export const meterSchema = z.object({
  uniqueId: meterIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  applicableTaxTypes: z.array(taxTypeIdSchema).nullable(),
});
export type Meter = z.infer<typeof meterSchema>;
