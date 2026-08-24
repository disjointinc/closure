import { z } from "zod";
import { epochMs } from "./common.ts";
import { paymentMethodIdSchema } from "./ids.ts";

/**
 * A tenant's payment method. Only provider references are stored -- no
 * payment details ever touch our servers.
 */
export const paymentMethodSchema = z.object({
  unique_id: paymentMethodIdSchema,
  created_at: epochMs,
  deleted_at: epochMs.nullable(),
  /** At most one method per tenant may be default (enforced on the tenant). */
  is_default: z.boolean(),
  provider_internals: z.object({
    /** Payment provider, e.g. "stripe", "adyen". */
    id: z.string().min(1),
    method_id: z.string().min(1),
  }),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
