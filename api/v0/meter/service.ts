/**
 * v0/meter/service.ts -- meter business logic. Immutable, so deletes
 * deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { meters, meterTaxTypes } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Meter } from "../../schemas/meter.ts";
import type { MeterCreateBody } from "./routes.ts";

export async function getMeter({
  meterId,
}: {
  meterId: string;
}): Promise<Meter | null> {
  const [row] = await db
    .select()
    .from(meters)
    .where(eq(meters.meterId, meterId));
  if (!row) {
    return null;
  }
  const taxTypeRows = await db
    .select()
    .from(meterTaxTypes)
    .where(eq(meterTaxTypes.meterId, meterId));
  return {
    meterId: row.meterId,
    productLineIds: row.productLineIds,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    name: row.name,
    description: row.description,
    applicableTaxTypeIds: taxTypeRows.map((taxType) => taxType.taxTypeId),
  };
}

export async function listMeters(): Promise<Meter[]> {
  const rows = await db.select().from(meters);
  const found = await Promise.all(
    rows.map((row) => getMeter({ meterId: row.meterId })),
  );
  return found.filter((meter) => meter !== null);
}

export async function createMeter({
  meter,
}: {
  meter: MeterCreateBody;
}): Promise<Meter> {
  const meterId = generateId({ prefix: "meter" });
  const createdAt = Date.now();
  await db
    .insert(meters)
    .values({
      meterId,
      productLineIds: meter.productLineIds,
      createdAt,
      deprecatedAt: null,
      name: meter.name,
      description: meter.description,
    })
    .onConflictDoNothing();
  if (meter.applicableTaxTypeIds.length > 0) {
    await db
      .insert(meterTaxTypes)
      .values(
        meter.applicableTaxTypeIds.map((taxTypeId) => ({
          meterId,
          taxTypeId,
        })),
      )
      .onConflictDoNothing();
  }
  return { ...meter, meterId, createdAt, deprecatedAt: null };
}

/** Deprecate the meter, or return null if no such meter exists. */
export async function deprecateMeter({
  meterId,
}: {
  meterId: string;
}): Promise<Meter | null> {
  const updated = await db
    .update(meters)
    .set({ deprecatedAt: Date.now() })
    .where(eq(meters.meterId, meterId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getMeter({ meterId });
}
