/**
 * v0/tax/service.ts -- tax business logic. taxType may be an existing id
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
  z.object({ ...taxSchema.shape, taxType: taxTypeRefSchema }),
]);

/** Resolve a tax reference to an id, upserting inline definitions. */
export async function resolveTaxRef(
  ref: z.infer<typeof taxRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  const taxTypeId = await resolveTaxTypeRef(ref.taxType);
  await db
    .insert(taxes)
    .values({ ...ref, taxType: taxTypeId })
    .onConflictDoNothing();
  return ref.uniqueId;
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
  return row ?? null;
}

export async function listTaxes(): Promise<Tax[]> {
  return db.select().from(taxes);
}

export async function createTax({ tax }: { tax: TaxCreateBody }): Promise<Tax> {
  const taxTypeId = await resolveTaxTypeRef(tax.taxType);
  await db
    .insert(taxes)
    .values({ ...tax, taxType: taxTypeId })
    .onConflictDoNothing();
  return { ...tax, taxType: taxTypeId };
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
