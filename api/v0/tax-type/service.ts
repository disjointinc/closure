/**
 * v0/tax-types/service.ts -- tax type business logic. Rarely edited, but
 * still first-class: created here, referenced by id, and deprecated like
 * other immutable definitions.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { taxTypes } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import { taxTypeSchema, type TaxType } from "../../schemas/tax-type.ts";

/** The tax type create body: no id or lifecycle fields. */
export const taxTypeCreateSchema = taxTypeSchema.omit({
  taxTypeId: true,
  createdAt: true,
  deprecatedAt: true,
});
export type TaxTypeCreateBody = z.infer<typeof taxTypeCreateSchema>;

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

export async function createTaxType({
  taxType,
}: {
  taxType: TaxTypeCreateBody;
}): Promise<TaxType | null> {
  const taxTypeId = generateId({ prefix: "tax_type" });
  await db
    .insert(taxTypes)
    .values({
      ...taxType,
      taxTypeId,
      createdAt: Date.now(),
      deprecatedAt: null,
    })
    .onConflictDoNothing();
  return getTaxType({ taxTypeId });
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
