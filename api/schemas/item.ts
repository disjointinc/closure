import { z } from "zod";
import { itemIdSchema, valueIdSchema } from "./ids.ts";

/** A line item on an invoice. */
export const itemSchema = z.object({
  uniqueId: itemIdSchema,
  perUnitValue: valueIdSchema,
  units: z.number().nonnegative(),
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type Item = z.infer<typeof itemSchema>;
