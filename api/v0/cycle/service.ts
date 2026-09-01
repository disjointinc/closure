/**
 * v0/cycle/service.ts -- cycle business logic. Cycles are shared, first-class
 * definitions: created here and referenced by id everywhere else. The call
 * surface passes dunning late-fee amounts as full value objects; the
 * canonical cycle stored in the db keeps value ids.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { cycles, values } from "../../db/schema.ts";
import {
  durationSchema,
  epochMs,
  type Duration,
} from "../../schemas/common.ts";
import {
  type Cycle,
  type DunningAction,
  upfrontChargingSchema,
} from "../../schemas/cycle.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";
import { valueSchema, type Value } from "../../schemas/value.ts";

/** Call-surface dunning actions: late fees carry the full value. */
const dunningActionApiSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("retry_customer"),
    notes: z.string(),
  }),
  // A late fee is a flat amount and/or a percentage of the invoice; at least
  // one must be set.
  z
    .object({
      type: z.literal("add_late_fee"),
      fixedValue: valueSchema.nullable(),
      percentageOfInvoice: z.number().positive().nullable(),
    })
    .refine(
      (action) =>
        action.fixedValue !== null || action.percentageOfInvoice !== null,
      {
        message: "add_late_fee requires a flat fee and/or a percentage",
      },
    ),
]);

const dunningScheduleApiSchema = z.array(
  z.object({
    /** How long after the due date these actions trigger. */
    after: durationSchema,
    actions: z.array(dunningActionApiSchema).min(1),
  }),
);
export type DunningScheduleApi = z.infer<typeof dunningScheduleApiSchema>;

/** Call-surface arrears charging: dunning late fees are full values. */
export const arrearsChargingApiSchema = z.object({
  charged: z.literal("arrears"),
  cycleLength: durationSchema,
  creditPeriod: durationSchema,
  gracePeriod: durationSchema.nullable(),
  dunningSchedule: dunningScheduleApiSchema,
});

const cycleFields = {
  cycleId: cycleIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  defaultDiscountPercentage: z.number().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
};

/** The cycle shape the call surface reads and writes. */
export const cycleApiSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(cycleFields),
  arrearsChargingApiSchema.extend(cycleFields),
]);
export type CycleApi = z.infer<typeof cycleApiSchema>;

type DunningSchedule = { after: Duration; actions: DunningAction[] }[];

/** Store a call-surface dunning schedule's values, returning the canonical one. */
export async function resolveDunning(
  dunning: DunningScheduleApi,
): Promise<DunningSchedule> {
  const resolved: DunningSchedule = [];
  for (const entry of dunning) {
    const actions: DunningAction[] = [];
    for (const action of entry.actions) {
      if (action.type === "retry_customer") {
        actions.push(action);
        continue;
      }
      if (action.fixedValue !== null) {
        await db.insert(values).values(action.fixedValue).onConflictDoNothing();
      }
      actions.push({
        type: "add_late_fee",
        fixedValueId:
          action.fixedValue === null ? null : action.fixedValue.valueId,
        percentageOfInvoice: action.percentageOfInvoice,
      });
    }
    resolved.push({ after: entry.after, actions });
  }
  return resolved;
}

/** Expand a stored dunning schedule's late-fee value ids into full values. */
export async function expandDunning(
  dunning: DunningSchedule | null,
): Promise<DunningScheduleApi> {
  const schedule = dunning ?? [];
  const lateFeeIds = schedule.flatMap((entry) =>
    entry.actions
      .filter(
        (action): action is Extract<DunningAction, { type: "add_late_fee" }> =>
          action.type === "add_late_fee",
      )
      .map((action) => action.fixedValueId)
      .filter((valueId): valueId is string => valueId !== null),
  );
  const valueRows = lateFeeIds.length
    ? await db.select().from(values).where(inArray(values.valueId, lateFeeIds))
    : [];
  const valueById = new Map(valueRows.map((value) => [value.valueId, value]));
  return schedule.map((entry) => ({
    after: entry.after,
    actions: entry.actions.map((action) => {
      if (action.type === "retry_customer") {
        return action;
      }
      // A late-fee value row always exists once its id is stored.
      const fixedValue =
        action.fixedValueId === null
          ? null
          : (valueById.get(action.fixedValueId) as Value);
      return {
        type: "add_late_fee" as const,
        fixedValue,
        percentageOfInvoice: action.percentageOfInvoice,
      };
    }),
  }));
}

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
    dunningSchedule: row.dunningSchedule ?? [],
  };
}

async function rowToCycleApi(
  row: typeof cycles.$inferSelect,
): Promise<CycleApi> {
  const cycle = rowToCycle(row);
  if (cycle.charged === "upfront") {
    return cycle;
  }
  return {
    ...cycle,
    dunningSchedule: await expandDunning(cycle.dunningSchedule),
  };
}

export async function listCycles(): Promise<CycleApi[]> {
  const rows = await db.select().from(cycles);
  return Promise.all(rows.map(rowToCycleApi));
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
  return rowToCycleApi(row);
}

/** Create a cycle, storing dunning late-fee values as ids. */
export async function createCycle({
  cycle,
}: {
  cycle: CycleApi;
}): Promise<CycleApi | null> {
  const stored: Cycle =
    cycle.charged === "upfront"
      ? cycle
      : {
          ...cycle,
          dunningSchedule: await resolveDunning(cycle.dunningSchedule),
        };
  await db.insert(cycles).values(cycleToRow(stored)).onConflictDoNothing();
  return getCycle({ cycleId: cycle.cycleId });
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
