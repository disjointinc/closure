/**
 * v0/tenant/payment-method/service.ts -- payment method business logic. Only
 * provider references are stored. Soft-deleted; at most one active default
 * per tenant (enforced by a partial unique index).
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { paymentMethods } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { PaymentMethod } from "../../../schemas/payment-method.ts";
import type { PaymentMethodCreateBody } from "./routes.ts";

export async function listPaymentMethods({
  tenantId,
}: {
  tenantId: string;
}): Promise<PaymentMethod[]> {
  return db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.tenantId, tenantId));
}

export async function createPaymentMethod({
  paymentMethod,
  tenantId,
}: {
  paymentMethod: PaymentMethodCreateBody;
  tenantId: string;
}): Promise<PaymentMethod> {
  const created: PaymentMethod = {
    ...paymentMethod,
    paymentMethodId: generateId({ prefix: "payment_method" }),
    tenantId,
    createdAt: Date.now(),
    deletedAt: null,
    isDefault: false,
  };
  await db.insert(paymentMethods).values(created).onConflictDoNothing();
  return created;
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
  // (tenant_id) where is_default is never violated mid-flight.
  const updated = await db.transaction(async (tx) => {
    await tx
      .update(paymentMethods)
      .set({ isDefault: false })
      .where(eq(paymentMethods.tenantId, tenantId));
    return tx
      .update(paymentMethods)
      .set({ isDefault: true })
      .where(
        and(
          eq(paymentMethods.paymentMethodId, paymentMethodId),
          eq(paymentMethods.tenantId, tenantId),
          isNull(paymentMethods.deletedAt),
        ),
      )
      .returning();
  });
  return updated[0] ?? null;
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
        eq(paymentMethods.paymentMethodId, paymentMethodId),
        eq(paymentMethods.tenantId, tenantId),
      ),
    )
    .returning();
  return updated[0] ?? null;
}
