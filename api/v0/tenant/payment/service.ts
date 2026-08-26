/**
 * v0/tenant/payment/service.ts -- payment business logic. Lifecycle timestamps
 * are patched as the 3P provider reports them.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { paymentInvoices, payments } from "../../../db/schema.ts";
import type { Payment } from "../../../schemas/payment.ts";
import type { PaymentPatchBody } from "./routes.ts";

export async function getPayment({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(eq(payments.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const invoiceRows = await db
    .select()
    .from(paymentInvoices)
    .where(eq(paymentInvoices.payment, uniqueId));
  return {
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    startedProcessingAt: row.startedProcessingAt,
    succeededAt: row.succeededAt,
    failedAt: row.failedAt,
    providerInternals: row.providerInternals,
    invoices: invoiceRows.map((invoice) => invoice.invoice),
  };
}

export async function listPayments({
  tenantId,
}: {
  tenantId: string;
}): Promise<Payment[]> {
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.tenant, tenantId))
    .orderBy(desc(payments.createdAt));
  const found = await Promise.all(
    rows.map((row) => getPayment({ uniqueId: row.uniqueId })),
  );
  return found.filter((payment) => payment !== null);
}

export async function createPayment({
  payment,
  tenantId,
}: {
  payment: Payment;
  tenantId: string;
}): Promise<Payment | null> {
  await db
    .insert(payments)
    .values({
      uniqueId: payment.uniqueId,
      tenant: tenantId,
      createdAt: payment.createdAt,
      startedProcessingAt: payment.startedProcessingAt,
      succeededAt: payment.succeededAt,
      failedAt: payment.failedAt,
      providerInternals: payment.providerInternals,
    })
    .onConflictDoNothing();
  if (payment.invoices.length > 0) {
    await db
      .insert(paymentInvoices)
      .values(
        payment.invoices.map((invoice) => ({
          payment: payment.uniqueId,
          invoice,
        })),
      )
      .onConflictDoNothing();
  }
  return getPayment({ uniqueId: payment.uniqueId });
}

/** Patch the payment, or return null if no such payment exists. */
export async function patchPayment({
  patch,
  paymentId,
}: {
  patch: PaymentPatchBody;
  paymentId: string;
}): Promise<Payment | null> {
  const updated = await db
    .update(payments)
    .set({
      ...(patch.startedProcessingAt !== undefined
        ? { startedProcessingAt: patch.startedProcessingAt }
        : {}),
      ...(patch.succeededAt !== undefined
        ? { succeededAt: patch.succeededAt }
        : {}),
      ...(patch.failedAt !== undefined ? { failedAt: patch.failedAt } : {}),
    })
    .where(eq(payments.uniqueId, paymentId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getPayment({ uniqueId: paymentId });
}
