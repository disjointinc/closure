/**
 * v0/cycles/service.ts -- cycle business logic. Cycles have no route of
 * their own: they're shared definitions composed into other resources,
 * referenced by id or defined inline (upserted by their client-provided
 * unique_id).
 */
import { z } from "zod";
import { db } from "../../db/index.ts";
import { cycles } from "../../db/schema.ts";
import { cycleSchema, type Cycle } from "../../schemas/cycle.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";

/** A cycle reference: an existing id or the full inline object. */
export const cycleRefSchema = z.union([cycleIdSchema, cycleSchema]);

function cycleToRow(cycle: Cycle) {
  const base = {
    uniqueId: cycle.unique_id,
    createdAt: cycle.created_at,
    deprecatedAt: cycle.deprecated_at,
    name: cycle.name,
    description: cycle.description,
    charged: cycle.charged,
    cycleLength: cycle.cycle_length,
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
    creditPeriod: cycle.credit_period,
    gracePeriod: cycle.grace_period,
    dunningSchedule: cycle.dunning_schedule,
  };
}

/** Resolve a cycle reference to an id, upserting inline definitions. */
export async function resolveCycleRef(
  ref: z.infer<typeof cycleRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(cycles).values(cycleToRow(ref)).onConflictDoNothing();
  return ref.unique_id;
}
