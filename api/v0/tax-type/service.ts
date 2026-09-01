/**
 * v0/tax-types/service.ts -- tax type business logic. Rarely edited, but
 * still first-class: created here, referenced by id, and deprecated like
 * other immutable definitions. Taxes may still inline them (upsert by id).
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { taxTypes } from "../../db/schema.ts";
import { taxTypeIdSchema } from "../../schemas/ids.ts";
import { taxTypeSchema, type TaxType } from "../../schemas/tax-type.ts";

/** A tax type reference: an existing id or the full inline object. */
export const taxTypeRefSchema = z.union([taxTypeIdSchema, taxTypeSchema]);

export async function listTaxTypes(): Promise<TaxType[]> {
  return db.select().from(taxTypes);
}

export async function getTaxType({
  taxTypeId,
}: {
  taxTypeId: string;
}): Promise<TaxType | null> {
  const [row] = await db
    .select()
    .from(taxTypes)
    .where(eq(taxTypes.taxTypeId, taxTypeId));
  if (!row) {
    return null;
  }
  return row;
}

/** Resolve a tax type reference to an id, upserting inline definitions. */
export async function resolveTaxTypeRef(
  ref: z.infer<typeof taxTypeRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(taxTypes).values(ref).onConflictDoNothing();
  return ref.taxTypeId;
}

export async function createTaxType({
  taxType,
}: {
  taxType: TaxType;
}): Promise<TaxType | null> {
  await db.insert(taxTypes).values(taxType).onConflictDoNothing();
  return getTaxType({ taxTypeId: taxType.taxTypeId });
}

/** Deprecate the tax type, or return null if no such tax type exists. */
export async function deprecateTaxType({
  taxTypeId,
}: {
  taxTypeId: string;
}): Promise<TaxType | null> {
  const updated = await db
    .update(taxTypes)
    .set({ deprecatedAt: Date.now() })
    .where(eq(taxTypes.taxTypeId, taxTypeId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getTaxType({ taxTypeId });
}
