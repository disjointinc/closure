import { z } from "zod";
import { currencyAmountSchema } from "./common.ts";
import { itemIdSchema, taxIdSchema, taxationAmountIdSchema } from "./ids.ts";

/** A tax charged on an invoice, computed by the 3P tax provider. */
export const taxationAmountSchema = z.object({
  taxationAmountId: taxationAmountIdSchema,
  taxId: taxIdSchema,
  /** Null means the tax applies to the whole invoice. */
  appliesToItemIds: z.array(itemIdSchema).nullable(),
  description: z.string().nullable(),
  /** The tax owed, in the invoice's smallest billable currency unit. */
  amount: currencyAmountSchema,
});
export type TaxationAmount = z.infer<typeof taxationAmountSchema>;
