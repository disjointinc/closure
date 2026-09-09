/**
 * v0/tenant/invoice/service.ts -- invoice business logic. Invoices wrap their
 * items and taxation amounts: all are passed inline on create. Item per-unit
 * values are owned objects, read and written as full values; taxes stay
 * references. Invoices are closed, never deleted.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  invoices,
  items,
  taxationAmountItems,
  taxationAmounts,
  values,
} from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { Duration } from "../../../schemas/common.ts";
import type { Invoice } from "../../../schemas/invoice.ts";
import type { Item } from "../../../schemas/item.ts";
import { type Value } from "../../../schemas/value.ts";
import type { CloseInvoiceBody, InvoiceCreateBody } from "./routes.ts";

type InvoiceItemApi = Omit<Item, "perUnitValueId"> & { perUnitValue: Value };

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

/** The call-surface invoice: items carry full values. */
export type InvoiceApi =
  | (Omit<Extract<Invoice, { charged: "upfront" }>, "items"> & {
      items: InvoiceItemApi[];
    })
  | (Omit<Extract<Invoice, { charged: "arrears" }>, "items"> & {
      items: InvoiceItemApi[];
    });

export async function getInvoice({
  invoiceId,
}: {
  invoiceId: string;
}): Promise<InvoiceApi | null> {
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
  const valueRows = itemRows.length
    ? await db
        .select()
        .from(values)
        .where(
          inArray(
            values.valueId,
            itemRows.map((item) => item.perUnitValueId),
          ),
        )
    : [];
  const valueById = new Map(valueRows.map((value) => [value.valueId, value]));
  const base = {
    invoiceId: row.invoiceId,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    closedReason: row.closedReason,
    items: itemRows.map((item) => ({
      itemId: item.itemId,
      // items.per_unit_value_id FKs values, so the row always exists.
      perUnitValue: valueById.get(item.perUnitValueId) as Value,
      units: item.units,
      name: item.name,
      description: item.description,
    })),
    taxationAmounts: await Promise.all(
      taxRows.map(async (tax) => {
        const appliesTo = await db
          .select()
          .from(taxationAmountItems)
          .where(
            eq(taxationAmountItems.taxationAmountId, tax.taxationAmountId),
          );
        return {
          taxationAmountId: tax.taxationAmountId,
          taxId: tax.taxId,
          appliesToItemIds: appliesTo.length
            ? appliesTo.map((item) => item.itemId)
            : null,
          description: tax.description,
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
  };
}

export async function listInvoices({
  tenantId,
}: {
  tenantId: string;
}): Promise<InvoiceApi[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId))
    .orderBy(desc(invoices.createdAt));
  const found = await Promise.all(
    rows.map((row) => getInvoice({ invoiceId: row.invoiceId })),
  );
  return found.filter((invoice) => invoice !== null);
}

export async function createInvoice({
  invoice,
  tenantId,
}: {
  invoice: InvoiceCreateBody;
  tenantId: string;
}): Promise<InvoiceApi | null> {
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
          closedAt: null,
          closedReason: null,
          charged: invoice.charged,
          cycleLength: invoice.cycleLength,
          ...charging,
        })
        .onConflictDoNothing();
      const itemIds: string[] = [];
      for (const item of invoice.items) {
        const valueId = generateId({ prefix: "value" });
        const itemId = generateId({ prefix: "item" });
        await tx
          .insert(values)
          .values({
            valueId,
            createdAt,
            deprecatedAt: null,
            name: item.perUnitValue.name,
            description: item.perUnitValue.description,
            amounts: item.perUnitValue.amounts,
          })
          .onConflictDoNothing();
        await tx
          .insert(items)
          .values({
            itemId,
            invoiceId,
            perUnitValueId: valueId,
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
        if (tax.appliesToItemIndexes) {
          await tx
            .insert(taxationAmountItems)
            .values(
              /* Validated in-range by invoiceCreateSchema's superRefine. */
              tax.appliesToItemIndexes.map((itemIndex) => ({
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

/** Close the invoice, or return null if no such invoice exists. */
export async function closeInvoice({
  body,
  invoiceId,
}: {
  body: CloseInvoiceBody;
  invoiceId: string;
}): Promise<InvoiceApi | null> {
  const updated = await db
    .update(invoices)
    .set({ closedAt: Date.now(), closedReason: body.closedReason })
    .where(eq(invoices.invoiceId, invoiceId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getInvoice({ invoiceId });
}
