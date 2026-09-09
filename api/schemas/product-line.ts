import { z } from "zod";
import { epochMs } from "./common.ts";
import { productLineIdSchema } from "./ids.ts";

/**
 * A distinct line of business (e.g. compute vs. support). Features and
 * meters belong to exactly one product line; plans and add-on types
 * reference only their own line's; a tenant holds at most one open
 * assignment per line. That makes "the tenant's billing cycle" well-defined
 * per line, which is what cycle-anchored rules and quotas key off.
 */
export const productLineSchema = z.object({
  productLineId: productLineIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  /**
   * Lines this one's billing cycle is forced into sync with. Symmetric and
   * transitive in effect: synchronized tenants' open assignments across the
   * group share one startsAt/cycleId (enforced at assignment create).
   */
  forceBillingCycleSynchronizationWithProductLineIds:
    z.array(productLineIdSchema),
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type ProductLine = z.infer<typeof productLineSchema>;
