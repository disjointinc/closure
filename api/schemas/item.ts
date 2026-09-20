import { z } from "zod";
import { amountsSchema } from "./common.ts";
import { itemIdSchema } from "./ids.ts";

/** A line item on an invoice. */
export const itemSchema = z.object({
  itemId: itemIdSchema,
  perUnitAmounts: amountsSchema,
  units: z.number().nonnegative(),
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type Item = z.infer<typeof itemSchema>;
