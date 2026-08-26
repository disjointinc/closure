/**
 * v0/tenant/invoice/service.ts -- invoice business logic. Invoices wrap their
 * items and taxation amounts: all are passed inline on create. Item values
 * and taxes accept existing ids or inline definitions. Invoices are closed,
 * never deleted.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  invoices,
  items,
  taxationAmountItems,
  taxationAmounts,
} from "../../../db/schema.ts";
import type { Duration } from "../../../schemas/common.ts";
import type { Invoice } from "../../../schemas/invoice.ts";
import { resolveTaxRef } from "../../tax/service.ts";
import { resolveValueRef } from "../../value/service.ts";
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
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    closedReason: row.closedReason,
    items: itemRows.map((item) => ({
      uniqueId: item.uniqueId,
      perUnitValue: item.perUnitValue,
      units: item.units,
      name: item.name,
      description: item.description,
    })),
    taxationAmounts: await Promise.all(
      taxRows.map(async (tax) => {
        const appliesTo = await db
          .select()
          .from(taxationAmountItems)
          .where(eq(taxationAmountItems.taxationAmount, tax.uniqueId));
        return {
          uniqueId: tax.uniqueId,
          tax: tax.tax,
          appliesToItems: appliesTo.length
            ? appliesTo.map((item) => item.item)
            : null,
          notes: tax.notes,
          amount: tax.amount,
        };
      }),
    ),
  };
  if (row.charged === "upfront") {
    return { ...base, charged: "upfront", cycleLength: row.cycleLength };
  }
  // The charging check constraint guarantees the arrears fields are set.
  return {
    ...base,
    charged: "arrears",
    cycleLength: row.cycleLength as Duration,
    creditPeriod: row.creditPeriod as Duration,
    gracePeriod: row.gracePeriod,
    dunningSchedule: row.dunningSchedule ?? [],
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
          creditPeriod: invoice.creditPeriod,
          gracePeriod: invoice.gracePeriod,
          dunningSchedule: invoice.dunningSchedule,
        };
  await db
    .insert(invoices)
    .values({
      uniqueId: invoice.uniqueId,
      tenant: tenantId,
      createdAt: invoice.createdAt,
      closedAt: invoice.closedAt,
      closedReason: invoice.closedReason,
      charged: invoice.charged,
      cycleLength: invoice.cycleLength,
      ...charging,
    })
    .onConflictDoNothing();
  for (const item of invoice.items) {
    await db
      .insert(items)
      .values({
        uniqueId: item.uniqueId,
        invoice: invoice.uniqueId,
        perUnitValue: await resolveValueRef(item.perUnitValue),
        units: item.units,
        name: item.name,
        description: item.description,
      })
      .onConflictDoNothing();
  }
  for (const tax of invoice.taxationAmounts) {
    await db
      .insert(taxationAmounts)
      .values({
        uniqueId: tax.uniqueId,
        invoice: invoice.uniqueId,
        tax: await resolveTaxRef(tax.tax),
        notes: tax.notes,
        amount: tax.amount,
      })
      .onConflictDoNothing();
    if (tax.appliesToItems) {
      await db
        .insert(taxationAmountItems)
        .values(
          tax.appliesToItems.map((item) => ({
            taxationAmount: tax.uniqueId,
            item,
          })),
        )
        .onConflictDoNothing();
    }
  }
  return getInvoice({ uniqueId: invoice.uniqueId });
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
    .set({ closedAt: body.closedAt, closedReason: body.closedReason })
    .where(eq(invoices.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getInvoice({ uniqueId });
}
