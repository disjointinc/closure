/**
 * cache/reconcile.test.ts -- integration tests for the auto-heal reconciler:
 * pending-grant application, drift heals, pending-stream subtraction, and
 * the negative-expectation guard.
 *
 * Shares the scratch Postgres + throwaway Redis with metering.test.ts; see
 * test_helpers.ts for setup requirements. Files run sequentially
 * (api/vitest.config.ts).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.ts";
import { creditGrants, meterBalances, meterEvents } from "../db/schema.ts";
import { redis } from "./index.ts";
import { keys } from "./keys.ts";
import {
  flushPendingMeterEvents,
  getMeterBalance,
  recordMeterEvent,
  redisTimeMicros,
  setMeterBalance,
} from "./metering.ts";
import { reconcileMeterBalances } from "./reconcile.ts";
import {
  closeTestState,
  makeEvent,
  makeMeter,
  makeTeamMember,
  makeTenant,
  newCreditGrantId,
  pgEventCount,
  resetTestState,
} from "./test-helpers.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

describe("reconciler", () => {
  it("applies pending grants and heals drift, exactly converging", async () => {
    // Two fixtures with a pg checkpoint but a missing Redis key, to exercise
    // the reconciler's rebuild path deterministically.
    for (let i = 0; i < 2; i++) {
      const rebuildTenant = await makeTenant();
      const rebuildMeter = await makeMeter();
      await setMeterBalance({
        balanceMicrocredits: 5_000,
        meterId: rebuildMeter,
        tenantId: rebuildTenant,
      });
      await redis.del(
        keys.meterBalance({ meterId: rebuildMeter, tenantId: rebuildTenant }),
      );
    }

    const tenant = await makeTenant();
    const meter = await makeMeter();
    const by = await makeTeamMember();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    // Drift: a decrement that never reaches pg (e.g. lost stream entry).
    await redis.decrby(
      keys.meterBalance({ meterId: meter, tenantId: tenant }),
      50_000,
    );
    // A grant recorded in pg but never applied (crash between insert and
    // INCRBY).
    const grantId = newCreditGrantId();
    await db.insert(creditGrants).values({
      uniqueId: grantId,
      tenant,
      meter,
      on: Date.now(),
      byTeamMember: by,
      reason: "test",
      amountMicrocredits: 100_000,
    });

    const first = await reconcileMeterBalances();
    // Counts can exceed the fixtures created here: the scratch pg database
    // persists across test runs, and earlier runs' fixtures are
    // rebuilt/healed here too.
    expect(first.appliedGrants).toBeGreaterThanOrEqual(1);
    expect(first.healed).toBeGreaterThanOrEqual(1);
    expect(first.rebuilt).toBeGreaterThanOrEqual(2);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      1_100_000,
    );

    // Converged: a second pass changes nothing (grant marker dedupes, no
    // drift).
    const second = await reconcileMeterBalances();
    expect(second.appliedGrants).toBe(0);
    expect(second.healed).toBe(0);
    expect(second.rebuilt).toBe(0);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      1_100_000,
    );

    // An event still buffered on the stream (decremented in Redis, not yet
    // in pg) must not be "healed" away: the reconciler subtracts pending
    // debits.
    expect(
      (
        await recordMeterEvent({
          event: makeEvent({ amount: 10_000, meter, tenant }),
        })
      ).status,
    ).toBe("succeeded");
    const third = await reconcileMeterBalances();
    expect(third.healed).toBe(0);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      1_090_000,
    );

    // After the flush lands it in pg, still converged. (The flush also
    // drains other tests' leftovers, so assert on this tenant's row.)
    await flushPendingMeterEvents();
    expect(await pgEventCount({ tenant })).toBe(1);
    const fourth = await reconcileMeterBalances();
    expect(fourth.healed).toBe(0);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      1_090_000,
    );
  });

  it("skips and logs a heal whose pg-derived expectation is negative", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 0,
      meterId: meter,
      tenantId: tenant,
    });

    // A succeeded event lands in pg without ever touching Redis (e.g. a
    // flush that outlived the Redis-side decrement): the pg-derived
    // expectation is now negative, which the hot path can never produce.
    const seeded = makeEvent({ amount: 100_000, meter, tenant });
    await db.insert(meterEvents).values({
      uniqueId: seeded.unique_id,
      uniqueExternalId: seeded.unique_external_id ?? seeded.unique_id,
      createdAt: seeded.created_at,
      receivedAt: await redisTimeMicros(),
      meter,
      tenant,
      amountMicrocredits: seeded.amount,
      status: "succeeded",
    });
    await redis.set(
      keys.meterBalance({ meterId: meter, tenantId: tenant }),
      50_000,
    );

    const report = await reconcileMeterBalances();
    // No heal: the guard refuses to push the balance negative.
    expect(report.healed).toBe(0);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      50_000,
    );

    // Keep cross-run state clean: remove the seeded inconsistency.
    await db
      .delete(meterEvents)
      .where(eq(meterEvents.uniqueId, seeded.unique_id));
    await redis.del(keys.meterBalance({ meterId: meter, tenantId: tenant }));
    await redis.srem(
      keys.trackedMeterBalances,
      keys.meterBalance({ meterId: meter, tenantId: tenant }),
    );
    await db
      .delete(meterBalances)
      .where(
        and(eq(meterBalances.tenant, tenant), eq(meterBalances.meter, meter)),
      );
  });
});
