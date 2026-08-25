/**
 * v0/meter/service.ts -- meter business logic. Immutable, so deletes
 * deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { meters, meterTaxTypes } from "../../db/schema.ts";
import type { Meter } from "../../schemas/meter.ts";

export async function getMeter({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Meter | null> {
  const [row] = await db
    .select()
    .from(meters)
    .where(eq(meters.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const taxTypeRows = await db
    .select()
    .from(meterTaxTypes)
    .where(eq(meterTaxTypes.meter, uniqueId));
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    deprecated_at: row.deprecatedAt,
    name: row.name,
    description: row.description,
    applicable_tax_types: taxTypeRows.length
      ? taxTypeRows.map((taxType) => taxType.taxType)
      : null,
  };
}

export async function listMeters(): Promise<Meter[]> {
  const rows = await db.select().from(meters);
  const found = await Promise.all(
    rows.map((row) => getMeter({ uniqueId: row.uniqueId })),
  );
  return found.filter((meter) => meter !== null);
}

export async function createMeter({ meter }: { meter: Meter }): Promise<void> {
  await db
    .insert(meters)
    .values({
      uniqueId: meter.unique_id,
      createdAt: meter.created_at,
      deprecatedAt: meter.deprecated_at,
      name: meter.name,
      description: meter.description,
    })
    .onConflictDoNothing();
  if (meter.applicable_tax_types) {
    await db
      .insert(meterTaxTypes)
      .values(
        meter.applicable_tax_types.map((taxType) => ({
          meter: meter.unique_id,
          taxType,
        })),
      )
      .onConflictDoNothing();
  }
}

/** Deprecate the meter, or return null if no such meter exists. */
export async function deprecateMeter({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Meter | null> {
  const updated = await db
    .update(meters)
    .set({ deprecatedAt: Date.now() })
    .where(eq(meters.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getMeter({ uniqueId });
}
