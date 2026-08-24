import { z } from "zod";
import { epochMs } from "./common.ts";
import { assignmentSchema } from "./assignment.ts";
import { couponGrantSchema } from "./coupon_grant.ts";
import { couponReceiptSchema } from "./coupon_receipt.ts";
import { creditGrantSchema } from "./credit_grant.ts";
import { featureOverrideSchema } from "./feature_override.ts";
import { tenantIdSchema } from "./ids.ts";
import { invoiceSchema } from "./invoice.ts";
import { meterOverrideSchema } from "./meter_override.ts";
import { paymentSchema } from "./payment.ts";
import { paymentMethodSchema } from "./payment_method.ts";
import { refundSchema } from "./refund.ts";

export const tenantSchema = z
  .object({
    unique_id: tenantIdSchema,
    created_at: epochMs,
    deleted_at: epochMs.optional(),
    /** External systems' ids for this tenant, keyed by system name. */
    external_ids: z.record(z.string(), z.string()),
    assignments: z.array(assignmentSchema),
    invoices: z.array(invoiceSchema).optional(),
    payment_methods: z.array(paymentMethodSchema).optional(),
    payments: z.array(paymentSchema).optional(),
    refunds: z.array(refundSchema).optional(),
    feature_overrides: z.array(featureOverrideSchema).optional(),
    meter_overrides: z.array(meterOverrideSchema),
    credit_grants: z.array(creditGrantSchema),
    coupons_received: z.array(couponReceiptSchema),
    coupons_granted: z.array(couponGrantSchema),
  })
  .superRefine((tenant, ctx) => {
    const defaults = (tenant.payment_methods ?? []).filter(
      (method) => method.is_default,
    );
    if (defaults.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["payment_methods"],
        message: "only one payment method may be default",
      });
    }
  });
export type Tenant = z.infer<typeof tenantSchema>;
