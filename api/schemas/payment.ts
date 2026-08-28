import { z } from "zod";
import { epochMs } from "./common.ts";
import { invoiceIdSchema, paymentIdSchema } from "./ids.ts";

export const paymentSchema = z.object({
  paymentId: paymentIdSchema,
  createdAt: epochMs,
  startedProcessingAt: epochMs.nullable(),
  succeededAt: epochMs.nullable(),
  failedAt: epochMs.nullable(),
  providerInternals: z.object({
    /** Payment provider, e.g. "stripe", "adyen". */
    provider: z.string().min(1),
    paymentId: z.string().min(1),
    customerId: z.string().min(1),
  }),
  invoiceIds: z.array(invoiceIdSchema),
});
export type Payment = z.infer<typeof paymentSchema>;
