/**
 * v0/tenant/invoice/service.ts -- invoice business logic. Invoices wrap their
 * items and taxation amounts: all are passed inline on create. Item per-unit
 * amounts are stored inline; taxes stay references. Invoices are finalized,
 * never deleted.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  invoices,
  items,
  taxationAmountItems,
  taxationAmounts,
} from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { Duration } from "../../../schemas/common.ts";
import type { Invoice } from "../../../schemas/invoice.ts";
import type { InvoiceCreateBody } from "./routes.ts";

/** Thrown when the invoice body references a tax that does not exist. */
export class InvoiceTaxNotFoundError extends Error {}

/* taxation_amounts.tax_id's FK: the only client-supplied reference written
 * by createInvoice, so its violation means the request's taxId is unknown. */
const TAXATION_AMOUNT_TAX_FK = "taxation_amounts_tax_id_taxes_tax_id_fk";

/** Error-cause chains are user-controlled in theory; bound the walk. */
const ERROR_CAUSE_MAX_DEPTH = 10;

/**
 * Whether the cause chain holds a Postgres foreign-key violation (23503) on
 * the given constraint. Drizzle wraps postgres-js errors, so the pg error is
 * never the top-level one.
 */
function isForeignKeyViolation({
  constraint,
  error,
}: {
  constraint: string;
  error: unknown;
}): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < ERROR_CAUSE_MAX_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if ("code" in current && "constraint_name" in current) {
      return current.code === "23503" && current.constraint_name === constraint;
    }
    if (!("cause" in current)) {
      return false;
    }
    current = current.cause;
  }
  return false;
}

/**
 * Assemble the call-surface invoice from already-fetched rows. Items and
 * taxation amounts must belong to the invoice; taxItemIdsByTax holds each
 * taxation amount's item links.
 */
function expandInvoice({
  row,
  itemRows,
  taxRows,
  taxItemIdsByTax,
}: {
  row: typeof invoices.$inferSelect;
  itemRows: (typeof items.$inferSelect)[];
  taxRows: (typeof taxationAmounts.$inferSelect)[];
  taxItemIdsByTax: Map<string, string[]>;
}): Invoice {
  const base = {
    invoiceId: row.invoiceId,
    createdAt: row.createdAt,
    finalizedAt: row.finalizedAt,
    items: itemRows.map((item) => ({
      itemId: item.itemId,
      perUnitAmounts: item.perUnitAmounts,
      units: item.units,
      name: item.name,
      description: item.description,
    })),
    taxationAmounts: taxRows.map((tax) => ({
      taxationAmountId: tax.taxationAmountId,
      taxId: tax.taxId,
      onlyApplyToItemIds: taxItemIdsByTax.get(tax.taxationAmountId) ?? null,
      description: tax.description,
      amount: tax.amount,
    })),
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
  };
}

export async function getInvoice({
  invoiceId,
}: {
  invoiceId: string;
}): Promise<Invoice | null> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.invoiceId, invoiceId));
  if (!row) {
    return null;
  }
  const itemRows = await db
    .select()
    .from(items)
    .where(eq(items.invoiceId, invoiceId));
  const taxRows = await db
    .select()
    .from(taxationAmounts)
    .where(eq(taxationAmounts.invoiceId, invoiceId));
  const taxItemRows = taxRows.length
    ? await db
        .select()
        .from(taxationAmountItems)
        .where(
          inArray(
            taxationAmountItems.taxationAmountId,
            taxRows.map((tax) => tax.taxationAmountId),
          ),
        )
    : [];
  const taxItemIdsByTax = new Map<string, string[]>();
  for (const link of taxItemRows) {
    taxItemIdsByTax.set(link.taxationAmountId, [
      ...(taxItemIdsByTax.get(link.taxationAmountId) ?? []),
      link.itemId,
    ]);
  }
  return expandInvoice({ row, itemRows, taxRows, taxItemIdsByTax });
}

export async function listInvoices({
  tenantId,
}: {
  tenantId: string;
}): Promise<Invoice[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId))
    .orderBy(desc(invoices.createdAt));
  if (rows.length === 0) {
    return [];
  }
  const invoiceIds = rows.map((row) => row.invoiceId);
  const itemRows = await db
    .select()
    .from(items)
    .where(inArray(items.invoiceId, invoiceIds));
  const taxRows = await db
    .select()
    .from(taxationAmounts)
    .where(inArray(taxationAmounts.invoiceId, invoiceIds));
  const taxItemRows = taxRows.length
    ? await db
        .select()
        .from(taxationAmountItems)
        .where(
          inArray(
            taxationAmountItems.taxationAmountId,
            taxRows.map((tax) => tax.taxationAmountId),
          ),
        )
    : [];
  const taxItemIdsByTax = new Map<string, string[]>();
  for (const link of taxItemRows) {
    taxItemIdsByTax.set(link.taxationAmountId, [
      ...(taxItemIdsByTax.get(link.taxationAmountId) ?? []),
      link.itemId,
    ]);
  }
  const itemsByInvoice = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    itemsByInvoice.set(item.invoiceId, [
      ...(itemsByInvoice.get(item.invoiceId) ?? []),
      item,
    ]);
  }
  const taxesByInvoice = new Map<string, typeof taxRows>();
  for (const tax of taxRows) {
    taxesByInvoice.set(tax.invoiceId, [
      ...(taxesByInvoice.get(tax.invoiceId) ?? []),
      tax,
    ]);
  }
  return rows.map((row) =>
    expandInvoice({
      row,
      itemRows: itemsByInvoice.get(row.invoiceId) ?? [],
      taxRows: taxesByInvoice.get(row.invoiceId) ?? [],
      taxItemIdsByTax,
    }),
  );
}

export async function createInvoice({
  invoice,
  tenantId,
}: {
  invoice: InvoiceCreateBody;
  tenantId: string;
}): Promise<Invoice | null> {
  const invoiceId = generateId({ prefix: "invoice" });
  const createdAt = Date.now();
  const charging =
    invoice.charged === "upfront"
      ? { creditPeriod: null, gracePeriod: null }
      : {
          creditPeriod: invoice.creditPeriod,
          gracePeriod: invoice.gracePeriod,
        };
  try {
    /* One transaction: an unknown tax id fails the tax FK mid-write, and a
     * half-written invoice must never survive that. */
    await db.transaction(async (tx) => {
      await tx
        .insert(invoices)
        .values({
          invoiceId,
          tenantId,
          createdAt,
          finalizedAt: null,
          charged: invoice.charged,
          cycleLength: invoice.cycleLength,
          ...charging,
        })
        .onConflictDoNothing();
      const itemIds: string[] = [];
      for (const item of invoice.items) {
        const itemId = generateId({ prefix: "item" });
        await tx
          .insert(items)
          .values({
            itemId,
            invoiceId,
            perUnitAmounts: item.perUnitAmounts,
            units: item.units,
            name: item.name,
            description: item.description,
          })
          .onConflictDoNothing();
        itemIds.push(itemId);
      }
      for (const tax of invoice.taxationAmounts) {
        const taxationAmountId = generateId({ prefix: "taxation_amount" });
        await tx
          .insert(taxationAmounts)
          .values({
            taxationAmountId,
            invoiceId,
            taxId: tax.taxId,
            description: tax.description,
            amount: tax.amount,
          })
          .onConflictDoNothing();
        if (tax.onlyApplyToItemIndexes) {
          await tx
            .insert(taxationAmountItems)
            .values(
              /* Validated in-range by invoiceCreateSchema's superRefine. */
              tax.onlyApplyToItemIndexes.map((itemIndex) => ({
                taxationAmountId,
                itemId: itemIds[itemIndex],
              })),
            )
            .onConflictDoNothing();
        }
      }
    });
  } catch (error) {
    if (isForeignKeyViolation({ constraint: TAXATION_AMOUNT_TAX_FK, error })) {
      throw new InvoiceTaxNotFoundError("Tax not found");
    }
    throw error;
  }
  return getInvoice({ invoiceId });
}

/** Finalize the invoice, or return null if no such invoice exists. */
export async function finalizeInvoice({
  invoiceId,
}: {
  invoiceId: string;
}): Promise<Invoice | null> {
  const updated = await db
    .update(invoices)
    .set({ finalizedAt: Date.now() })
    .where(eq(invoices.invoiceId, invoiceId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getInvoice({ invoiceId });
}
