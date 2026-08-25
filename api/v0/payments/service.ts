/**
 * v0/payments/service.ts -- payment business logic. Lifecycle timestamps
 * are patched as the 3P provider reports them.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { paymentInvoices, payments } from "../../db/schema.ts";
import type { Payment } from "../../schemas/payment.ts";
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
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    started_processing_at: row.startedProcessingAt,
    succeeded_at: row.succeededAt,
    failed_at: row.failedAt,
    provider_internals: row.providerInternals,
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
      uniqueId: payment.unique_id,
      tenant: tenantId,
      createdAt: payment.created_at,
      startedProcessingAt: payment.started_processing_at,
      succeededAt: payment.succeeded_at,
      failedAt: payment.failed_at,
      providerInternals: payment.provider_internals,
    })
    .onConflictDoNothing();
  if (payment.invoices.length > 0) {
    await db
      .insert(paymentInvoices)
      .values(
        payment.invoices.map((invoice) => ({
          payment: payment.unique_id,
          invoice,
        })),
      )
      .onConflictDoNothing();
  }
  return getPayment({ uniqueId: payment.unique_id });
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
      ...(patch.started_processing_at !== undefined
        ? { startedProcessingAt: patch.started_processing_at }
        : {}),
      ...(patch.succeeded_at !== undefined
        ? { succeededAt: patch.succeeded_at }
        : {}),
      ...(patch.failed_at !== undefined ? { failedAt: patch.failed_at } : {}),
    })
    .where(eq(payments.uniqueId, paymentId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getPayment({ uniqueId: paymentId });
}
