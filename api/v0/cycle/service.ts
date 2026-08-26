/**
 * v0/cycles/service.ts -- cycle business logic. Cycles have no route of
 * their own: they're shared definitions composed into other resources,
 * referenced by id or defined inline (upserted by their client-provided
 * uniqueId).
 */
import { z } from "zod";
import { db } from "../../db/index.ts";
import { cycles } from "../../db/schema.ts";
import type { Duration } from "../../schemas/common.ts";
import { cycleSchema, type Cycle } from "../../schemas/cycle.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";

/** A cycle reference: an existing id or the full inline object. */
export const cycleRefSchema = z.union([cycleIdSchema, cycleSchema]);

function cycleToRow(cycle: Cycle) {
  const base = {
    uniqueId: cycle.uniqueId,
    createdAt: cycle.createdAt,
    deprecatedAt: cycle.deprecatedAt,
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
      dunningSchedule: null,
    };
  }
  return {
    ...base,
    creditPeriod: cycle.creditPeriod,
    gracePeriod: cycle.gracePeriod,
    dunningSchedule: cycle.dunningSchedule,
  };
}

function rowToCycle(row: typeof cycles.$inferSelect): Cycle {
  const base = {
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
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
    dunningSchedule: row.dunningSchedule ?? [],
  };
}

export async function listCycles(): Promise<Cycle[]> {
  const rows = await db.select().from(cycles);
  return rows.map(rowToCycle);
}

/** Resolve a cycle reference to an id, upserting inline definitions. */
export async function resolveCycleRef(
  ref: z.infer<typeof cycleRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(cycles).values(cycleToRow(ref)).onConflictDoNothing();
  return ref.uniqueId;
}
