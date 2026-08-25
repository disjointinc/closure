/**
 * v0/tax-types/service.ts -- tax type business logic. Tax types have no
 * route of their own: they're shared definitions composed into taxes,
 * referenced by id or defined inline (upserted by their client-provided
 * unique_id).
 */
import { z } from "zod";
import { db } from "../../db/index.ts";
import { taxTypes } from "../../db/schema.ts";
import { taxTypeIdSchema } from "../../schemas/ids.ts";
import { taxTypeSchema, type TaxType } from "../../schemas/tax-type.ts";

/** A tax type reference: an existing id or the full inline object. */
export const taxTypeRefSchema = z.union([taxTypeIdSchema, taxTypeSchema]);

function taxTypeToRow(taxType: TaxType) {
  return {
    uniqueId: taxType.unique_id,
    createdAt: taxType.created_at,
    deprecatedAt: taxType.deprecated_at,
    name: taxType.name,
    description: taxType.description,
  };
}

/** Resolve a tax type reference to an id, upserting inline definitions. */
export async function resolveTaxTypeRef(
  ref: z.infer<typeof taxTypeRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(taxTypes).values(taxTypeToRow(ref)).onConflictDoNothing();
  return ref.unique_id;
}
