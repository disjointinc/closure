/**
 * v0/cycle/service.ts -- cycle business logic. Cycles are shared, first-class
 * definitions: created here and referenced by id everywhere else.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { cycles } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import { epochMs, type Duration } from "../../schemas/common.ts";
import {
  arrearsChargingSchema,
  type Cycle,
  upfrontChargingSchema,
} from "../../schemas/cycle.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";

const cycleBaseFields = {
  defaultDiscountPercentage: z.number().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
};

const cycleFields = {
  cycleId: cycleIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  ...cycleBaseFields,
};

/** The cycle shape the call surface reads and writes. */
export const cycleApiSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(cycleFields),
  arrearsChargingSchema.extend(cycleFields),
]);
export type CycleApi = z.infer<typeof cycleApiSchema>;

/** The cycle create body: no id or lifecycle fields. */
export const cycleCreateSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(cycleBaseFields),
  arrearsChargingSchema.extend(cycleBaseFields),
]);
export type CycleCreateBody = z.infer<typeof cycleCreateSchema>;

function cycleToRow(cycle: Cycle) {
  const base = {
    cycleId: cycle.cycleId,
    createdAt: cycle.createdAt,
    deprecatedAt: cycle.deprecatedAt,
    defaultDiscountPercentage: cycle.defaultDiscountPercentage,
    name: cycle.name,
    description: cycle.description,
    charged: cycle.charged,
    cycleLength: cycle.cycleLength,
  };
  if (cycle.charged === "upfront") {
    return {
      ...base,
      creditPeriod: null,
      gracePeriod: null,
    };
  }
  return {
    ...base,
    creditPeriod: cycle.creditPeriod,
    gracePeriod: cycle.gracePeriod,
  };
}

function rowToCycle(row: typeof cycles.$inferSelect): Cycle {
  const base = {
    cycleId: row.cycleId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
    defaultDiscountPercentage: row.defaultDiscountPercentage,
    name: row.name,
    description: row.description,
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

export async function listCycles(): Promise<CycleApi[]> {
  const rows = await db.select().from(cycles);
  return rows.map(rowToCycle);
}

export async function getCycle({
  cycleId,
}: {
  cycleId: string;
}): Promise<CycleApi | null> {
  const [row] = await db
    .select()
    .from(cycles)
    .where(eq(cycles.cycleId, cycleId));
  if (!row) {
    return null;
  }
  return rowToCycle(row);
}

/** Create a cycle. */
export async function createCycle({
  cycle,
}: {
  cycle: CycleCreateBody;
}): Promise<CycleApi> {
  const created: CycleApi = {
    ...cycle,
    cycleId: generateId({ prefix: "cycle" }),
    createdAt: Date.now(),
    deprecatedAt: null,
  };
  await db.insert(cycles).values(cycleToRow(created)).onConflictDoNothing();
  return created;
}

/** Deprecate the cycle, or return null if no such cycle exists. */
export async function deprecateCycle({
  cycleId,
}: {
  cycleId: string;
}): Promise<CycleApi | null> {
  const updated = await db
    .update(cycles)
    .set({ deprecatedAt: Date.now() })
    .where(eq(cycles.cycleId, cycleId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getCycle({ cycleId });
}
