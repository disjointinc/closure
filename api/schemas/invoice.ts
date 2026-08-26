import { z } from "zod";
import { epochMs } from "./common.ts";
import { arrearsChargingSchema, upfrontChargingSchema } from "./cycle.ts";
import { invoiceIdSchema } from "./ids.ts";
import { itemSchema } from "./item.ts";
import { taxationAmountSchema } from "./taxation-amount.ts";

const invoiceFields = {
  uniqueId: invoiceIdSchema,
  createdAt: epochMs,
  closedAt: epochMs.nullable(),
  closedReason: z.string().nullable(),
  items: z.array(itemSchema),
  taxationAmounts: z.array(taxationAmountSchema),
};

/** An invoice carries the charging behavior of its cycle. */
export const invoiceSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(invoiceFields),
  arrearsChargingSchema.extend(invoiceFields),
]);
export type Invoice = z.infer<typeof invoiceSchema>;
