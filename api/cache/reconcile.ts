/**
 * cache/reconcile.ts -- periodic drift detection and auto-heal.
 *
 * The checkpoint + read-repair machinery in cache/metering.ts makes balances
 * exactly recoverable after Redis loss; this loop is the safety net for
 * steady-state drift (crash windows between pg and Redis writes, theoretical
 * clock-boundary races). Every interval:
 *
 *   1. Apply grants that never reached Redis (applied_at IS NULL) --
 *      idempotently, via the mgrant: marker.
 *   2. For every tracked or checkpointed balance key, compare the Redis
 *      value against the pg-derived expectation and heal drift with an
 *      INCRBY of the difference -- commutative with concurrent decrements,
 *      so no locking is needed and repeated runs converge.
 *
 * Events still buffered on mev:pending have decremented Redis but aren't in
 * pg yet, so their amounts are subtracted from the pg-derived expectation;
 * healing them away would briefly over-credit the tenant (fail open).
 * Missing keys are rebuilt from pg (see metering.ts).
 */
import { isNull } from "drizzle-orm";
import { db } from "../db/index.ts";
import { creditGrants, meterBalances } from "../db/schema.ts";
import { redis } from "./index.ts";
import { keys } from "./keys.ts";
import {
  adjustMeterBalance,
  applyCreditGrant,
  parsePendingEntry,
  rebuildMeterBalance,
  stampGrantApplied,
  sumAppliedGrants,
  sumSucceededMeterEvents,
} from "./metering.ts";

/** Above this backlog, skip the heal pass rather than XRANGE the world. */
const MAX_STREAM_SCAN = 5_000;
/** How many unapplied grants to apply per pass. */
const PENDING_GRANT_BATCH = 500;

export type ReconcileReport = {
  appliedGrants: number;
  checked: number;
  rebuilt: number;
  healed: number;
  skipped: boolean;
};

export async function reconcileMeterBalances(): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    appliedGrants: 0,
    checked: 0,
    rebuilt: 0,
    healed: 0,
    skipped: false,
  };

  // 1. Grants recorded in pg but never applied to Redis.
  const pendingGrants = await db
    .select()
    .from(creditGrants)
    .where(isNull(creditGrants.appliedAt))
    .limit(PENDING_GRANT_BATCH);
  for (const grant of pendingGrants) {
    try {
      await applyCreditGrant({
        grant: {
          amount: grant.amountMicrocredits,
          meter: grant.meter,
          tenant: grant.tenant,
          uniqueId: grant.uniqueId,
        },
      });
      await stampGrantApplied({ grantId: grant.uniqueId });
      report.appliedGrants += 1;
    } catch (error) {
      console.error("reconciler could not apply grant", {
        error,
        grant: grant.uniqueId,
      });
    }
  }

  // 2. Heal drifted balances.
  const pending = await redis.xrange(keys.pendingMeterEvents, "-", "+");
  if (pending.length > MAX_STREAM_SCAN) {
    console.error("skipping balance reconcile: pending stream too deep", {
      depth: pending.length,
    });
    report.skipped = true;
    return report;
  }
  const pendingDebitByKey = new Map<string, number>();
  for (const [entryId, fields] of pending) {
    const { event, status } = parsePendingEntry({ entryId, fields });
    if (event === null || status !== "succeeded") {
      continue;
    }
    const key = keys.meterBalance({
      meterId: event.meter,
      tenantId: event.tenant,
    });
    pendingDebitByKey.set(
      key,
      (pendingDebitByKey.get(key) ?? 0) + event.amount,
    );
  }

  const checkpoints = await db.select().from(meterBalances);
  const checkpointByKey = new Map(
    checkpoints.map((row) => [
      keys.meterBalance({ meterId: row.meter, tenantId: row.tenant }),
      row,
    ]),
  );
  const keySet = new Set<string>(
    await redis.smembers(keys.trackedMeterBalances),
  );
  for (const key of checkpointByKey.keys()) {
    keySet.add(key);
  }
  for (const key of pendingDebitByKey.keys()) {
    keySet.add(key);
  }

  for (const key of keySet) {
    const parts = key.split(":");
    if (parts.length !== 3) {
      console.error("skipping malformed tracked balance key", { key });
      continue;
    }
    const [, tenant, meter] = parts;
    const checkpoint = checkpointByKey.get(key);
    const actual = await redis.get(key);
    if (actual === null && checkpoint) {
      await rebuildMeterBalance({ meterId: meter, tenantId: tenant });
      report.rebuilt += 1;
      continue;
    }
    if (actual === null) {
      continue;
    }
    if (!checkpoint) {
      // Pre-dates synchronous checkpoint writes; nothing durable to derive
      // from. The next checkpoint pass will establish a base row.
      console.error("meter balance key has no pg checkpoint; skipping", {
        meter,
        tenant,
      });
      continue;
    }
    const since = checkpoint.updatedAt;
    const eventsTotal = await sumSucceededMeterEvents({
      meterId: meter,
      since,
      tenantId: tenant,
    });
    const grantsTotal = await sumAppliedGrants({
      meterId: meter,
      since,
      tenantId: tenant,
    });
    const expected =
      checkpoint.balanceMicrocredits -
      eventsTotal +
      grantsTotal -
      (pendingDebitByKey.get(key) ?? 0);
    if (expected < 0) {
      // Impossible via the fail-closed hot path, so this means the durable
      // record itself is inconsistent -- healing would push Redis negative
      // and wedge the row's checkpoint against the pg CHECK constraint.
      console.error("pg-derived balance is negative; skipping heal", {
        checkpoint: checkpoint.balanceMicrocredits,
        eventsTotal,
        expected,
        grantsTotal,
        meter,
        tenant,
      });
      continue;
    }
    report.checked += 1;
    const drift = expected - Number(actual);
    if (drift !== 0) {
      // INCRBY the difference: commutative with concurrent decrements, so a
      // heal can't lose an event that lands mid-pass.
      await adjustMeterBalance({
        deltaMicrocredits: drift,
        meterId: meter,
        tenantId: tenant,
      });
      report.healed += 1;
      console.log("healed meter balance drift", {
        actual: Number(actual),
        drift,
        expected,
        meter,
        tenant,
      });
    }
  }
  return report;
}

const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Start the periodic reconciler. Interval is unref'd and errors are logged,
 * never thrown -- a failed pass just defers healing to the next one.
 */
export function startMeteringReconcileLoop(): void {
  const reconcile = setInterval(() => {
    reconcileMeterBalances().catch((error) =>
      console.error("meter reconcile failed", error),
    );
  }, RECONCILE_INTERVAL_MS);
  reconcile.unref();
}
