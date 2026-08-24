import { z } from "zod";
import { epochMs } from "./common.ts";
import { arrearsChargingSchema, upfrontChargingSchema } from "./cycle.ts";
import { invoiceIdSchema } from "./ids.ts";
import { itemSchema } from "./item.ts";
import { taxationAmountSchema } from "./taxation_amount.ts";

const invoiceFields = {
  unique_id: invoiceIdSchema,
  created_at: epochMs,
  closed_at: epochMs.optional(),
  closed_reason: z.string().optional(),
  items: z.array(itemSchema),
  taxation_amounts: z.array(taxationAmountSchema),
};

/** An invoice carries the charging behavior of its cycle. */
export const invoiceSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(invoiceFields),
  arrearsChargingSchema.extend(invoiceFields),
]);
export type Invoice = z.infer<typeof invoiceSchema>;
