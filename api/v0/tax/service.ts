/**
 * v0/tax/service.ts -- tax business logic. Immutable, so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { taxes } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Tax } from "../../schemas/tax.ts";
import type { TaxCreateBody } from "./routes.ts";

export async function getTax({
  taxId,
}: {
  taxId: string;
}): Promise<Tax | null> {
  const [row] = await db.select().from(taxes).where(eq(taxes.taxId, taxId));
  return row ?? null;
}

export async function listTaxes(): Promise<Tax[]> {
  return db.select().from(taxes);
}

export async function createTax({ tax }: { tax: TaxCreateBody }): Promise<Tax> {
  const created: Tax = {
    ...tax,
    taxId: generateId({ prefix: "tax" }),
    createdAt: Date.now(),
    deprecatedAt: null,
  };
  await db.insert(taxes).values(created).onConflictDoNothing();
  return created;
}

/** Deprecate the tax, or return null if no such tax exists. */
export async function deprecateTax({
  taxId,
}: {
  taxId: string;
}): Promise<Tax | null> {
  const updated = await db
    .update(taxes)
    .set({ deprecatedAt: Date.now() })
    .where(eq(taxes.taxId, taxId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getTax({ taxId });
}
