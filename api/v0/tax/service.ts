/**
 * v0/tax/service.ts -- tax business logic. tax_type may be an existing id
 * or an inline tax type. Immutable, so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { taxes } from "../../db/schema.ts";
import { taxIdSchema } from "../../schemas/ids.ts";
import { taxSchema, type Tax } from "../../schemas/tax.ts";
import { resolveTaxTypeRef, taxTypeRefSchema } from "../tax-type/service.ts";
import type { TaxCreateBody } from "./routes.ts";

/**
 * A tax reference: an existing id or the full inline object (whose tax type
 * may itself be inline).
 */
export const taxRefSchema = z.union([
  taxIdSchema,
  z.object({ ...taxSchema.shape, tax_type: taxTypeRefSchema }),
]);

/** Resolve a tax reference to an id, upserting inline definitions. */
export async function resolveTaxRef(
  ref: z.infer<typeof taxRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  const taxTypeId = await resolveTaxTypeRef(ref.tax_type);
  await db
    .insert(taxes)
    .values({
      uniqueId: ref.unique_id,
      createdAt: ref.created_at,
      deprecatedAt: ref.deprecated_at,
      taxType: taxTypeId,
      name: ref.name,
      description: ref.description,
    })
    .onConflictDoNothing();
  return ref.unique_id;
}

function rowToTax(row: typeof taxes.$inferSelect): Tax {
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    deprecated_at: row.deprecatedAt,
    tax_type: row.taxType,
    name: row.name,
    description: row.description,
  };
}

export async function getTax({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Tax | null> {
  const [row] = await db
    .select()
    .from(taxes)
    .where(eq(taxes.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  return rowToTax(row);
}

export async function listTaxes(): Promise<Tax[]> {
  const rows = await db.select().from(taxes);
  return rows.map(rowToTax);
}

export async function createTax({ tax }: { tax: TaxCreateBody }): Promise<Tax> {
  const taxTypeId = await resolveTaxTypeRef(tax.tax_type);
  await db
    .insert(taxes)
    .values({
      uniqueId: tax.unique_id,
      createdAt: tax.created_at,
      deprecatedAt: tax.deprecated_at,
      taxType: taxTypeId,
      name: tax.name,
      description: tax.description,
    })
    .onConflictDoNothing();
  return { ...tax, tax_type: taxTypeId };
}

/** Deprecate the tax, or return null if no such tax exists. */
export async function deprecateTax({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Tax | null> {
  const updated = await db
    .update(taxes)
    .set({ deprecatedAt: Date.now() })
    .where(eq(taxes.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getTax({ uniqueId });
}
