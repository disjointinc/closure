import { z } from "zod";
import { epochMs } from "./common.ts";
import { assignmentSchema } from "./assignment.ts";
import { couponGrantSchema } from "./coupon-grant.ts";
import { couponReceiptSchema } from "./coupon-receipt.ts";
import { creditGrantSchema } from "./credit-grant.ts";
import { featureOverrideSchema } from "./feature-override.ts";
import { tenantIdSchema } from "./ids.ts";
import { invoiceSchema } from "./invoice.ts";
import { meterOverrideSchema } from "./meter-override.ts";
import { paymentSchema } from "./payment.ts";
import { paymentMethodSchema } from "./payment-method.ts";
import { refundSchema } from "./refund.ts";

export const tenantSchema = z
  .object({
    tenantId: tenantIdSchema,
    createdAt: epochMs,
    deletedAt: epochMs.nullable(),
    /** External systems' ids for this tenant, keyed by system name. */
    externalIds: z.record(z.string(), z.string()),
    assignments: z.array(assignmentSchema),
    invoices: z.array(invoiceSchema),
    paymentMethods: z.array(paymentMethodSchema),
    payments: z.array(paymentSchema),
    refunds: z.array(refundSchema),
    featureOverrides: z.array(featureOverrideSchema),
    meterOverrides: z.array(meterOverrideSchema),
    creditGrants: z.array(creditGrantSchema),
    couponsReceived: z.array(couponReceiptSchema),
    couponsGranted: z.array(couponGrantSchema),
  })
  .superRefine((tenant, ctx) => {
    const defaults = tenant.paymentMethods.filter((method) => method.isDefault);
    if (defaults.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMethods"],
        message: "only one payment method may be default",
      });
    }
  });
export type Tenant = z.infer<typeof tenantSchema>;
