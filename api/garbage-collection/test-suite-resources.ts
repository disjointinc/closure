/**
 * garbage-collection/test-suite-resources.ts -- hard-deletes resources
 * created by test suites (docs/guide/quickstart.test.ts, and the api test
 * below). The API's delete routes only soft-delete (deprecated_at /
 * deleted_at), so this is the only path that actually frees the rows.
 *
 * This is invoked by test suites directly (each collects only its own
 * marker, so concurrent suites never delete each other's in-flight
 * resources). It is deliberately NOT registered in the production
 * garbage-collection loop (loop.ts): test-scoped collection is not
 * production behavior.
 *
 * The marker contract is shared with the test suites: every resource a test
 * suite creates carries TEST_SUITE_RESOURCE_MARKER plus its suite name --
 * as a name prefix (`<marker>-<suite>:`), or as the externalIds VALUE on
 * tenants (tenants have no name column; the key stays the base marker so
 * the jsonb exact-key lookup still works). If the marker format changes,
 * update the test suites too.
 *
 * One pass deletes in FK-safe order inside a single transaction. On any
 * error (e.g. real data has since referenced a marked resource) the pass
 * rolls back and the caller decides whether to retry.
 */
import { and, inArray, like, sql } from "drizzle-orm";
import { redis } from "../cache/index.ts";
import { keys } from "../cache/keys.ts";
import { db } from "../db/index.ts";
import {
  assignments,
  cycles,
  featureOptions,
  featureOverrides,
  features,
  featureTaxTypes,
  meterBalances,
  meterEvents,
  meterOverrides,
  meters,
  meterSpends,
  meterTaxTypes,
  planAddOnTypes,
  planFeatures,
  planMeters,
  planPrices,
  plans,
  productLines,
  ruleRuns,
  tasks,
  teamMembers,
  tenantLastActivity,
  tenants,
} from "../db/schema.ts";

export const TEST_SUITE_RESOURCE_MARKER = "resource-created-by-test-suite";

interface MarkedTenantMeter {
  tenantId: string;
  meterId: string;
  externalIds: string[];
}

export const createMarkedResource = ({
  name,
  suite,
}: {
  name: string;
  suite: string;
}) => `${TEST_SUITE_RESOURCE_MARKER}-${suite}: ${name}`;

const matchMarkedResource = ({ suite }: { suite: string }) =>
  `${TEST_SUITE_RESOURCE_MARKER}-${suite}:%`;

export async function collectTestSuiteResources({
  suite,
}: {
  suite: string;
}): Promise<void> {
  const markedResourcesMatcher = matchMarkedResource({ suite });

  /* Read the Redis key set (per marked tenant+meter, plus event idempotency
   * markers) before the rows they're derived from are deleted. */
  const markedTenantIds = (
    await db
      .select({ tenantId: tenants.tenantId })
      .from(tenants)
      .where(
        and(
          sql`${tenants.externalIds} ? ${TEST_SUITE_RESOURCE_MARKER}`,
          sql`${tenants.externalIds} ->> ${TEST_SUITE_RESOURCE_MARKER} = ${suite}`,
        ),
      )
  ).map((row) => row.tenantId);
  const redisCleanup: {
    keysToDelete: string[];
    keysToRemoveFromTrackedMeterBalancesSet: string[];
  } =
    markedTenantIds.length === 0
      ? { keysToDelete: [], keysToRemoveFromTrackedMeterBalancesSet: [] }
      : await markedRedisKeys({ markedTenantIds });

  const counts = await db.transaction(async (tx) => {
    const markedPlanIds = (
      await tx
        .select({ planId: plans.planId })
        .from(plans)
        .where(like(plans.name, markedResourcesMatcher))
    ).map((row) => row.planId);
    const markedFeatureIds = (
      await tx
        .select({ featureId: features.featureId })
        .from(features)
        .where(like(features.name, markedResourcesMatcher))
    ).map((row) => row.featureId);
    const markedMeterIds = (
      await tx
        .select({ meterId: meters.meterId })
        .from(meters)
        .where(like(meters.name, markedResourcesMatcher))
    ).map((row) => row.meterId);

    const counts: Record<string, number> = {};

    if (markedTenantIds.length > 0) {
      /* Rule activity references tenants too: a marked tenant whose rule
       * fired (or had a task created) is otherwise uncollectable. */
      counts.ruleRuns = (
        await tx
          .delete(ruleRuns)
          .where(inArray(ruleRuns.tenantId, markedTenantIds))
          .returning({ ruleRunId: ruleRuns.ruleRunId })
      ).length;
      counts.tasks = (
        await tx
          .delete(tasks)
          .where(inArray(tasks.tenantId, markedTenantIds))
          .returning({ taskId: tasks.taskId })
      ).length;
      counts.meterEvents = (
        await tx
          .delete(meterEvents)
          .where(inArray(meterEvents.tenantId, markedTenantIds))
          .returning({ meterEventId: meterEvents.meterEventId })
      ).length;
      counts.meterBalances = (
        await tx
          .delete(meterBalances)
          .where(inArray(meterBalances.tenantId, markedTenantIds))
          .returning({ tenantId: meterBalances.tenantId })
      ).length;
      counts.meterSpends = (
        await tx
          .delete(meterSpends)
          .where(inArray(meterSpends.tenantId, markedTenantIds))
          .returning({ tenantId: meterSpends.tenantId })
      ).length;
      counts.tenantLastActivity = (
        await tx
          .delete(tenantLastActivity)
          .where(inArray(tenantLastActivity.tenantId, markedTenantIds))
          .returning({ tenantId: tenantLastActivity.tenantId })
      ).length;
      counts.featureOverrides = (
        await tx
          .delete(featureOverrides)
          .where(inArray(featureOverrides.tenantId, markedTenantIds))
          .returning({ featureOverrideId: featureOverrides.featureOverrideId })
      ).length;
      counts.meterOverrides = (
        await tx
          .delete(meterOverrides)
          .where(inArray(meterOverrides.tenantId, markedTenantIds))
          .returning({ meterOverrideId: meterOverrides.meterOverrideId })
      ).length;
      counts.assignments = (
        await tx
          .delete(assignments)
          .where(inArray(assignments.tenantId, markedTenantIds))
          .returning({ assignmentId: assignments.assignmentId })
      ).length;
      counts.tenants = (
        await tx
          .delete(tenants)
          .where(inArray(tenants.tenantId, markedTenantIds))
          .returning({ tenantId: tenants.tenantId })
      ).length;
    }

    if (markedPlanIds.length > 0) {
      counts.planAddOnTypes = (
        await tx
          .delete(planAddOnTypes)
          .where(inArray(planAddOnTypes.planId, markedPlanIds))
          .returning({ planId: planAddOnTypes.planId })
      ).length;
      counts.planFeatures = (
        await tx
          .delete(planFeatures)
          .where(inArray(planFeatures.planId, markedPlanIds))
          .returning({ planId: planFeatures.planId })
      ).length;
      counts.planMeters = (
        await tx
          .delete(planMeters)
          .where(inArray(planMeters.planId, markedPlanIds))
          .returning({ planId: planMeters.planId })
      ).length;
      counts.planPrices = (
        await tx
          .delete(planPrices)
          .where(inArray(planPrices.planId, markedPlanIds))
          .returning({ planId: planPrices.planId })
      ).length;
      counts.plans = (
        await tx
          .delete(plans)
          .where(inArray(plans.planId, markedPlanIds))
          .returning({ planId: plans.planId })
      ).length;
    }

    if (markedFeatureIds.length > 0) {
      counts.featureOptions = (
        await tx
          .delete(featureOptions)
          .where(inArray(featureOptions.featureId, markedFeatureIds))
          .returning({ featureOptionId: featureOptions.featureOptionId })
      ).length;
      counts.featureTaxTypes = (
        await tx
          .delete(featureTaxTypes)
          .where(inArray(featureTaxTypes.featureId, markedFeatureIds))
          .returning({ featureId: featureTaxTypes.featureId })
      ).length;
      counts.features = (
        await tx
          .delete(features)
          .where(inArray(features.featureId, markedFeatureIds))
          .returning({ featureId: features.featureId })
      ).length;
    }

    if (markedMeterIds.length > 0) {
      counts.meterTaxTypes = (
        await tx
          .delete(meterTaxTypes)
          .where(inArray(meterTaxTypes.meterId, markedMeterIds))
          .returning({ meterId: meterTaxTypes.meterId })
      ).length;
      counts.meters = (
        await tx
          .delete(meters)
          .where(inArray(meters.meterId, markedMeterIds))
          .returning({ meterId: meters.meterId })
      ).length;
    }

    counts.cycles = (
      await tx
        .delete(cycles)
        .where(like(cycles.name, markedResourcesMatcher))
        .returning({
          cycleId: cycles.cycleId,
        })
    ).length;
    counts.teamMembers = (
      await tx
        .delete(teamMembers)
        .where(like(teamMembers.name, markedResourcesMatcher))
        .returning({ teamMemberId: teamMembers.teamMemberId })
    ).length;
    counts.productLines = (
      await tx
        .delete(productLines)
        .where(like(productLines.name, markedResourcesMatcher))
        .returning({ productLineId: productLines.productLineId })
    ).length;

    return counts;
  });

  /* Redis cleanup runs after the pg commit: meter_balances has FKs to
   * tenants and meters, so the checkpoint loop must never resurrect a
   * balance row for a deleted graph -- removing the keys (and their
   * mbal:tracked membership) is what stops that. */
  if (redisCleanup.keysToDelete.length > 0) {
    await redis.del(...redisCleanup.keysToDelete);
  }
  if (redisCleanup.keysToRemoveFromTrackedMeterBalancesSet.length > 0) {
    await redis.srem(
      keys.trackedMeterBalances,
      ...redisCleanup.keysToRemoveFromTrackedMeterBalancesSet,
    );
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total > 0) {
    console.log("garbage collection pass complete", counts);
  }
}

/** Every hot-path key derived from a marked tenant's pg rows. */
async function markedRedisKeys({
  markedTenantIds,
}: {
  markedTenantIds: string[];
}): Promise<{
  keysToDelete: string[];
  keysToRemoveFromTrackedMeterBalancesSet: string[];
}> {
  /* Group event externalIds by tenant+meter pair. Neither source table
   * alone covers every pair: events may not be checkpointed to
   * meter_balances yet, and a balance initialized at assignment has no
   * events until the first one lands. */
  const pairsToClean = new Map<string, MarkedTenantMeter>();

  const events = await db
    .select({
      tenantId: meterEvents.tenantId,
      meterId: meterEvents.meterId,
      externalId: meterEvents.externalId,
    })
    .from(meterEvents)
    .where(inArray(meterEvents.tenantId, markedTenantIds));
  for (const event of events) {
    const mapKey = `${event.tenantId}:${event.meterId}`;
    let pair = pairsToClean.get(mapKey);
    if (!pair) {
      pair = {
        tenantId: event.tenantId,
        meterId: event.meterId,
        externalIds: [],
      };
      pairsToClean.set(mapKey, pair);
    }
    pair.externalIds.push(event.externalId);
  }

  const balances = await db
    .select({
      tenantId: meterBalances.tenantId,
      meterId: meterBalances.meterId,
    })
    .from(meterBalances)
    .where(inArray(meterBalances.tenantId, markedTenantIds));
  for (const balance of balances) {
    const mapKey = `${balance.tenantId}:${balance.meterId}`;
    if (!pairsToClean.has(mapKey)) {
      pairsToClean.set(mapKey, { ...balance, externalIds: [] });
    }
  }

  const keysToDelete: string[] = [];
  for (const { tenantId, meterId, externalIds } of pairsToClean.values()) {
    keysToDelete.push(
      keys.meterBalance({ meterId, tenantId }),
      keys.meterSpend({ meterId, tenantId }),
      keys.lastActivity({ meterId, tenantId }),
      keys.ruleWatchSet({ meterId, tenantId }),
    );
    for (const externalId of externalIds) {
      keysToDelete.push(
        keys.meterEventIdempotency({ externalId, meterId, tenantId }),
      );
    }
  }

  /* mbal:tracked is the checkpoint loop's work list of balance key names;
   * a marked tenant's entries must come off it, or the loop would
   * resurrect the row in pg (see above). */
  const keysToRemoveFromTrackedMeterBalancesSet: string[] = [];
  for (const member of await redis.smembers(keys.trackedMeterBalances)) {
    const [, tenantId] = member.split(":");
    if (tenantId && markedTenantIds.includes(tenantId)) {
      keysToRemoveFromTrackedMeterBalancesSet.push(member);
    }
  }
  return { keysToDelete, keysToRemoveFromTrackedMeterBalancesSet };
}
