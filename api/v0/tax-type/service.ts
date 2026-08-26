/**
 * v0/tax-types/service.ts -- tax type business logic. Tax types have no
 * route of their own: they're shared definitions composed into taxes,
 * referenced by id or defined inline (upserted by their client-provided
 * uniqueId).
 */
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

/** Resolve a tax type reference to an id, upserting inline definitions. */
export async function resolveTaxTypeRef(
  ref: z.infer<typeof taxTypeRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(taxTypes).values(ref).onConflictDoNothing();
  return ref.uniqueId;
}
