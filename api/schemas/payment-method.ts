import { z } from "zod";
import { epochMs } from "./common.ts";
import { paymentMethodIdSchema, tenantIdSchema } from "./ids.ts";

/**
 * A tenant's payment method. Only provider references are stored -- no
 * payment details ever touch our servers.
 */
export const paymentMethodSchema = z.object({
  paymentMethodId: paymentMethodIdSchema,
  tenantId: tenantIdSchema,
  createdAt: epochMs,
  deletedAt: epochMs.nullable(),
  /** At most one method per tenant may be default (enforced on the tenant). */
  isDefault: z.boolean(),
  providerInternals: z.object({
    /** Payment provider, e.g. "stripe", "adyen". */
    provider: z.string().min(1),
    methodId: z.string().min(1),
  }),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
