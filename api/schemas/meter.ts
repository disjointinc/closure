import { z } from "zod";
import { epochMs } from "./common.ts";
import { meterIdSchema, productLineIdSchema, taxTypeIdSchema } from "./ids.ts";

export const meterSchema = z.object({
  meterId: meterIdSchema,
  /**
   * The product lines this meter applies to. A meter spanning several lines
   * can only anchor cycle-derived rule triggers (billing_cycle_end windows,
   * per-cycle spend) when all those lines are billing-cycle-synchronized.
   */
  productLineIds: z.array(productLineIdSchema).min(1),
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  applicableTaxTypeIds: z.array(taxTypeIdSchema).nullable(),
});
export type Meter = z.infer<typeof meterSchema>;
