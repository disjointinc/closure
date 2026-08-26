/**
 * v0/tenant/refund/service.ts -- refund business logic. The refunded value may be
 * an existing value id or an inline definition. Lifecycle timestamps are
 * patched as the 3P provider reports them.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { refunds } from "../../../db/schema.ts";
import type { Refund } from "../../../schemas/refund.ts";
import { resolveValueRef } from "../../value/service.ts";
import type { RefundCreateBody, RefundPatchBody } from "./routes.ts";

function rowToRefund(row: typeof refunds.$inferSelect): Refund {
  return {
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    startedProcessingAt: row.startedProcessingAt,
    succeededAt: row.succeededAt,
    failedAt: row.failedAt,
    by: row.byTeamMember,
    value: row.value,
    reason: row.reason,
  };
}

export async function getRefund({
  refundId,
}: {
  refundId: string;
}): Promise<Refund | null> {
  const [row] = await db
    .select()
    .from(refunds)
    .where(eq(refunds.uniqueId, refundId));
  if (!row) {
    return null;
  }
  return rowToRefund(row);
}

export async function listRefunds({
  tenantId,
}: {
  tenantId: string;
}): Promise<Refund[]> {
  const rows = await db
    .select()
    .from(refunds)
    .where(eq(refunds.tenant, tenantId))
    .orderBy(desc(refunds.createdAt));
  return rows.map(rowToRefund);
}

export async function createRefund({
  refund,
  tenantId,
}: {
  refund: RefundCreateBody;
  tenantId: string;
}): Promise<Refund> {
  const valueId = await resolveValueRef(refund.value);
  await db
    .insert(refunds)
    .values({
      uniqueId: refund.uniqueId,
      tenant: tenantId,
      createdAt: refund.createdAt,
      startedProcessingAt: refund.startedProcessingAt,
      succeededAt: refund.succeededAt,
      failedAt: refund.failedAt,
      byTeamMember: refund.by,
      value: valueId,
      reason: refund.reason,
    })
    .onConflictDoNothing();
  return { ...refund, value: valueId };
}

/** Patch the refund, or return null if no such refund exists. */
export async function patchRefund({
  patch,
  refundId,
}: {
  patch: RefundPatchBody;
  refundId: string;
}): Promise<Refund | null> {
  const updated = await db
    .update(refunds)
    .set({
      ...(patch.startedProcessingAt !== undefined
        ? { startedProcessingAt: patch.startedProcessingAt }
        : {}),
      ...(patch.succeededAt !== undefined
        ? { succeededAt: patch.succeededAt }
        : {}),
      ...(patch.failedAt !== undefined ? { failedAt: patch.failedAt } : {}),
    })
    .where(eq(refunds.uniqueId, refundId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToRefund(updated[0]);
}
