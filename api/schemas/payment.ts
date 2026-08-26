import { z } from "zod";
import { epochMs } from "./common.ts";
import { invoiceIdSchema, paymentIdSchema } from "./ids.ts";

export const paymentSchema = z.object({
  uniqueId: paymentIdSchema,
  createdAt: epochMs,
  startedProcessingAt: epochMs.nullable(),
  succeededAt: epochMs.nullable(),
  failedAt: epochMs.nullable(),
  providerInternals: z.object({
    /** Payment provider, e.g. "stripe", "adyen". */
    id: z.string().min(1),
    paymentId: z.string().min(1),
    customerId: z.string().min(1),
  }),
  invoices: z.array(invoiceIdSchema),
});
export type Payment = z.infer<typeof paymentSchema>;
