/**
 * v0/invoices/service.ts -- invoice business logic. Invoices wrap their
 * items and taxation amounts: all are passed inline on create. Item values
 * and taxes accept existing ids or inline definitions. Invoices are closed,
 * never deleted.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  invoices,
  items,
  taxationAmountItems,
  taxationAmounts,
} from "../../db/schema.ts";
import type { Duration } from "../../schemas/common.ts";
import type { Invoice } from "../../schemas/invoice.ts";
import { resolveTaxRef, resolveValueRef } from "../helpers.ts";
import type { CloseInvoiceBody, InvoiceCreateBody } from "./routes.ts";

export async function getInvoice({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Invoice | null> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const itemRows = await db
    .select()
    .from(items)
    .where(eq(items.invoice, uniqueId));
  const taxRows = await db
    .select()
    .from(taxationAmounts)
    .where(eq(taxationAmounts.invoice, uniqueId));
  const base = {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    closed_at: row.closedAt,
    closed_reason: row.closedReason,
    items: itemRows.map((item) => ({
      unique_id: item.uniqueId,
      per_unit_value: item.perUnitValue,
      units: item.units,
      name: item.name,
      description: item.description,
    })),
    taxation_amounts: await Promise.all(
      taxRows.map(async (tax) => {
        const appliesTo = await db
          .select()
          .from(taxationAmountItems)
          .where(eq(taxationAmountItems.taxationAmount, tax.uniqueId));
        return {
          unique_id: tax.uniqueId,
          tax: tax.tax,
          applies_to_items: appliesTo.length
            ? appliesTo.map((item) => item.item)
            : null,
          notes: tax.notes,
          amount: tax.amount,
        };
      }),
    ),
  };
  if (row.charged === "upfront") {
    return { ...base, charged: "upfront", cycle_length: row.cycleLength };
  }
  // The charging check constraint guarantees the arrears fields are set.
  return {
    ...base,
    charged: "arrears",
    cycle_length: row.cycleLength as Duration,
    credit_period: row.creditPeriod as Duration,
    grace_period: row.gracePeriod,
    dunning_schedule: row.dunningSchedule ?? [],
  };
}

export async function listInvoices({
  tenantId,
}: {
  tenantId: string;
}): Promise<Invoice[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.tenant, tenantId))
    .orderBy(desc(invoices.createdAt));
  const found = await Promise.all(
    rows.map((row) => getInvoice({ uniqueId: row.uniqueId })),
  );
  return found.filter((invoice) => invoice !== null);
}

export async function createInvoice({
  invoice,
  tenantId,
}: {
  invoice: InvoiceCreateBody;
  tenantId: string;
}): Promise<Invoice | null> {
  const charging =
    invoice.charged === "upfront"
      ? { creditPeriod: null, gracePeriod: null, dunningSchedule: null }
      : {
          creditPeriod: invoice.credit_period,
          gracePeriod: invoice.grace_period,
          dunningSchedule: invoice.dunning_schedule,
        };
  await db
    .insert(invoices)
    .values({
      uniqueId: invoice.unique_id,
      tenant: tenantId,
      createdAt: invoice.created_at,
      closedAt: invoice.closed_at,
      closedReason: invoice.closed_reason,
      charged: invoice.charged,
      cycleLength: invoice.cycle_length,
      ...charging,
    })
    .onConflictDoNothing();
  for (const item of invoice.items) {
    await db
      .insert(items)
      .values({
        uniqueId: item.unique_id,
        invoice: invoice.unique_id,
        perUnitValue: await resolveValueRef(item.per_unit_value),
        units: item.units,
        name: item.name,
        description: item.description,
      })
      .onConflictDoNothing();
  }
  for (const tax of invoice.taxation_amounts) {
    await db
      .insert(taxationAmounts)
      .values({
        uniqueId: tax.unique_id,
        invoice: invoice.unique_id,
        tax: await resolveTaxRef(tax.tax),
        notes: tax.notes,
        amount: tax.amount,
      })
      .onConflictDoNothing();
    if (tax.applies_to_items) {
      await db
        .insert(taxationAmountItems)
        .values(
          tax.applies_to_items.map((item) => ({
            taxationAmount: tax.unique_id,
            item,
          })),
        )
        .onConflictDoNothing();
    }
  }
  return getInvoice({ uniqueId: invoice.unique_id });
}

/** Close the invoice, or return null if no such invoice exists. */
export async function closeInvoice({
  body,
  uniqueId,
}: {
  body: CloseInvoiceBody;
  uniqueId: string;
}): Promise<Invoice | null> {
  const updated = await db
    .update(invoices)
    .set({ closedAt: body.closed_at, closedReason: body.closed_reason })
    .where(eq(invoices.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getInvoice({ uniqueId });
}
