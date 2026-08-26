/**
 * v0/tenant/payment-method/service.ts -- payment method business logic. Only
 * provider references are stored. Soft-deleted; at most one active default
 * per tenant (enforced by a partial unique index).
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { paymentMethods } from "../../../db/schema.ts";
import type { PaymentMethod } from "../../../schemas/payment-method.ts";

function rowToPaymentMethod(
  row: typeof paymentMethods.$inferSelect,
): PaymentMethod {
  return {
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    isDefault: row.isDefault,
    providerInternals: row.providerInternals,
  };
}

export async function listPaymentMethods({
  tenantId,
}: {
  tenantId: string;
}): Promise<PaymentMethod[]> {
  const rows = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.tenant, tenantId));
  return rows.map(rowToPaymentMethod);
}

export async function createPaymentMethod({
  paymentMethod,
  tenantId,
}: {
  paymentMethod: PaymentMethod;
  tenantId: string;
}): Promise<void> {
  await db
    .insert(paymentMethods)
    .values({
      uniqueId: paymentMethod.uniqueId,
      tenant: tenantId,
      createdAt: paymentMethod.createdAt,
      deletedAt: paymentMethod.deletedAt,
      isDefault: paymentMethod.isDefault,
      providerInternals: paymentMethod.providerInternals,
    })
    .onConflictDoNothing();
}

/** Set the default payment method, or return null if no such method exists. */
export async function setDefaultPaymentMethod({
  paymentMethodId,
  tenantId,
}: {
  paymentMethodId: string;
  tenantId: string;
}): Promise<PaymentMethod | null> {
  // Clear-then-set in one transaction so the partial unique index on
  // (tenant) where is_default is never violated mid-flight.
  const updated = await db.transaction(async (tx) => {
    await tx
      .update(paymentMethods)
      .set({ isDefault: false })
      .where(eq(paymentMethods.tenant, tenantId));
    return tx
      .update(paymentMethods)
      .set({ isDefault: true })
      .where(
        and(
          eq(paymentMethods.uniqueId, paymentMethodId),
          eq(paymentMethods.tenant, tenantId),
          isNull(paymentMethods.deletedAt),
        ),
      )
      .returning();
  });
  if (updated.length === 0) {
    return null;
  }
  return rowToPaymentMethod(updated[0]);
}

/** Soft-delete the payment method, or return null if no such method exists. */
export async function deletePaymentMethod({
  paymentMethodId,
  tenantId,
}: {
  paymentMethodId: string;
  tenantId: string;
}): Promise<PaymentMethod | null> {
  const updated = await db
    .update(paymentMethods)
    .set({ deletedAt: Date.now(), isDefault: false })
    .where(
      and(
        eq(paymentMethods.uniqueId, paymentMethodId),
        eq(paymentMethods.tenant, tenantId),
      ),
    )
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToPaymentMethod(updated[0]);
}
