/**
 * v0/tenant/meter-override/service.ts -- team-member-applied meter overrides for
 * a tenant. Top-up prices own their values on the call surface; the stored
 * jsonb keeps value ids.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { meterOverrides, values } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { MeterOverride } from "../../../schemas/meter-override.ts";
import type { PlanMeter } from "../../../schemas/plan.ts";
import { type Value } from "../../../schemas/value.ts";
import {
  expandTopUp,
  type TopUpApi,
  topUpValueIds,
} from "../../plan/service.ts";
import type { MeterOverrideCreateBody } from "./routes.ts";

/** The call-surface override: top-up prices carry full values. */
export type MeterOverrideApi = Omit<MeterOverride, "topUpPricesPerCredit"> & {
  topUpPricesPerCredit: TopUpApi;
};

export async function listMeterOverrides({
  tenantId,
}: {
  tenantId: string;
}): Promise<MeterOverrideApi[]> {
  const rows = await db
    .select()
    .from(meterOverrides)
    .where(eq(meterOverrides.tenantId, tenantId))
    .orderBy(desc(meterOverrides.createdAt));
  const valueIds = rows.flatMap((row) =>
    topUpValueIds(row.topUpPricesPerCredit),
  );
  const valueRows = valueIds.length
    ? await db.select().from(values).where(inArray(values.valueId, valueIds))
    : [];
  const valueById = new Map(valueRows.map((value) => [value.valueId, value]));
  const valueFor = (valueId: string): Value =>
    // Top-up values are stored at override creation, so the row exists.
    valueById.get(valueId) as Value;
  return rows.map((row) => ({
    ...row,
    topUpPricesPerCredit: expandTopUp(row.topUpPricesPerCredit, valueFor),
  }));
}

/**
 * Insert the override's top-up values, returning the call-surface top-up
 * (cycle ids, full values).
 */
async function resolveTopUp(
  topUps: MeterOverrideCreateBody["topUpPricesPerCredit"],
): Promise<TopUpApi> {
  if (topUps === null) {
    return null;
  }
  const createdAt = Date.now();
  const resolved = topUps.map((tier) => ({
    startingAt: tier.startingAt,
    prices: tier.prices.map((price) => ({
      cycleId: price.cycleId,
      value: {
        ...price.value,
        valueId: generateId({ prefix: "value" }),
        createdAt,
        deprecatedAt: null,
      },
    })),
  }));
  const valueRows = resolved.flatMap((tier) =>
    tier.prices.map((price) => price.value),
  );
  if (valueRows.length > 0) {
    await db.insert(values).values(valueRows).onConflictDoNothing();
  }
  return resolved;
}

/** The db-stored top-up: value ids in place of the full objects. */
function toStoredTopUp(topUp: TopUpApi): PlanMeter["topUpPricesPerCredit"] {
  if (topUp === null) {
    return null;
  }
  return topUp.map((tier) => ({
    startingAt: tier.startingAt,
    prices: tier.prices.map((price) => ({
      cycleId: price.cycleId,
      valueId: price.value.valueId,
    })),
  }));
}

export async function createMeterOverride({
  override,
  tenantId,
}: {
  override: MeterOverrideCreateBody;
  tenantId: string;
}): Promise<MeterOverrideApi> {
  const meterOverrideId = generateId({ prefix: "meter_override" });
  const createdAt = Date.now();
  const topUp = await resolveTopUp(override.topUpPricesPerCredit);
  await db
    .insert(meterOverrides)
    .values({
      ...override,
      meterOverrideId,
      createdAt,
      tenantId,
      topUpPricesPerCredit: toStoredTopUp(topUp),
    })
    .onConflictDoNothing();
  return {
    ...override,
    meterOverrideId,
    createdAt,
    tenantId,
    topUpPricesPerCredit: topUp,
  };
}
