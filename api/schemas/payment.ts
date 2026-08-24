import { z } from "zod";
import { epochMs } from "./common.ts";
import { invoiceIdSchema, paymentIdSchema } from "./ids.ts";

export const paymentSchema = z.object({
  unique_id: paymentIdSchema,
  created_at: epochMs,
  started_processing_at: epochMs.optional(),
  succeeded_at: epochMs.optional(),
  failed_at: epochMs.optional(),
  provider_internals: z.object({
    /** Payment provider, e.g. "stripe", "adyen". */
    id: z.string().min(1),
    payment_id: z.string().min(1),
    customer_id: z.string().min(1),
  }),
  invoices: z.array(invoiceIdSchema),
});
export type Payment = z.infer<typeof paymentSchema>;
