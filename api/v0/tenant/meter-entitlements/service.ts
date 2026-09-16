/**
 * v0/tenant/meter-entitlements/service.ts -- resolved meter entitlements:
 * every open assignment's plan meters, with the latest meter override per
 * meter winning. Merging follows the same startsAt latest-wins rule as
 * feature entitlements. Live balances are deliberately excluded: they are
 * hot-path state served per meter by tenant/meter-balance.
 */
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { assignments, meterOverrides, planMeters } from "../../../db/schema.ts";

export async function getMeterEntitlements({ tenantId }: { tenantId: string }) {
  const openAssignments = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.tenantId, tenantId),
        isNull(assignments.endsAt),
        lte(assignments.startsAt, Date.now()),
      ),
    )
    .orderBy(assignments.startsAt);
  if (openAssignments.length === 0) {
    return [];
  }

  const planMeterRows = (
    await Promise.all(
      openAssignments.map((assignment) =>
        db
          .select()
          .from(planMeters)
          .where(eq(planMeters.planId, assignment.planId)),
      ),
    )
  ).flat();
  const meterOverrideRows = await db
    .select()
    .from(meterOverrides)
    .where(eq(meterOverrides.tenantId, tenantId))
    .orderBy(desc(meterOverrides.createdAt));

  const meterMap = new Map<
    string,
    { defaultMicrocredits: number; limitMicrocredits: number | null }
  >();
  for (const row of planMeterRows) {
    meterMap.set(row.meterId, {
      defaultMicrocredits: row.defaultMicrocredits,
      limitMicrocredits: row.limitMicrocredits,
    });
  }
  const seenMeters = new Set<string>();
  for (const row of meterOverrideRows) {
    if (!seenMeters.has(row.meterId)) {
      seenMeters.add(row.meterId);
      meterMap.set(row.meterId, {
        defaultMicrocredits: row.defaultMicrocredits,
        limitMicrocredits: row.limitMicrocredits,
      });
    }
  }

  return [...meterMap.entries()].map(([meterId, config]) => ({
    meterId,
    defaultMicrocredits: config.defaultMicrocredits,
    limitMicrocredits: config.limitMicrocredits,
  }));
}
