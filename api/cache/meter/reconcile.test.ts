/**
 * cache/reconcile.test.ts -- integration tests for the auto-heal reconciler:
 * pending-grant application, drift heals, pending-stream subtraction, and
 * the negative-expectation guard.
 *
 * Shares the scratch Postgres + throwaway Redis with metering.test.ts; see
 * test-helpers.ts for setup requirements. Files run sequentially
 * (api/vitest.config.ts).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/index.ts";
import {
  creditGrants,
  meterBalances,
  meterEvents,
  meterSpends,
} from "../../db/schema.ts";
import { redis } from "../index.ts";
import { keys } from "../keys.ts";
import {
  flushPendingMeterEvents,
  getMeterBalance,
  rebuildMeterSpend,
  recordMeterEvent,
  redisTimeMicros,
  setMeterBalance,
} from "./index.ts";
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
} from "../test-helpers.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

describe("reconciler", () => {
  it("applies pending grants and heals drift, exactly converging", async () => {
    // Two fixtures with a pg checkpoint but a missing Redis key, to exercise
    // the reconciler's rebuild path deterministically.
    for (let i = 0; i < 2; i++) {
      const rebuildTenantId = await makeTenant();
      const rebuildMeterId = await makeMeter();
      await setMeterBalance({
        balanceMicrocredits: 5_000,
        meterId: rebuildMeterId,
        tenantId: rebuildTenantId,
      });
      await redis.del(
        keys.meterBalance({
          meterId: rebuildMeterId,
          tenantId: rebuildTenantId,
        }),
      );
    }

    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    const byTeamMemberId = await makeTeamMember();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    // Drift: a decrement that never reaches pg (e.g. lost stream entry).
    await redis.decrby(keys.meterBalance({ meterId, tenantId }), 50_000);
    // A grant recorded in pg but never applied (crash between insert and
    // INCRBY).
    const creditGrantId = newCreditGrantId();
    await db.insert(creditGrants).values({
      creditGrantId,
      tenantId,
      meterId,
      grantedAt: Date.now(),
      byTeamMemberId,
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
    expect(await getMeterBalance({ meterId, tenantId })).toBe(1_100_000);

    // Converged: a second pass changes nothing (grant marker dedupes, no
    // drift).
    const second = await reconcileMeterBalances();
    expect(second.appliedGrants).toBe(0);
    expect(second.healed).toBe(0);
    expect(second.rebuilt).toBe(0);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(1_100_000);

    // An event still buffered on the stream (decremented in Redis, not yet
    // in pg) must not be "healed" away: the reconciler subtracts pending
    // debits.
    expect(
      (
        await recordMeterEvent({
          event: makeEvent({ amountMicrocredits: 10_000, meterId, tenantId }),
        })
      ).status,
    ).toBe("succeeded");
    const third = await reconcileMeterBalances();
    expect(third.healed).toBe(0);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(1_090_000);

    // After the flush lands it in pg, still converged. (The flush also
    // drains other tests' leftovers, so assert on this tenant's row.)
    await flushPendingMeterEvents();
    expect(await pgEventCount({ tenantId })).toBe(1);
    const fourth = await reconcileMeterBalances();
    expect(fourth.healed).toBe(0);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(1_090_000);
  });

  it("skips and logs a heal whose pg-derived expectation is negative", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 0,
      meterId,
      tenantId,
    });

    // A succeeded event lands in pg without ever touching Redis (e.g. a
    // flush that outlived the Redis-side decrement): the pg-derived
    // expectation is now negative, which the hot path can never produce.
    const seeded = makeEvent({
      amountMicrocredits: 100_000,
      meterId,
      tenantId,
    });
    await db.insert(meterEvents).values({
      meterEventId: seeded.meterEventId,
      externalId: seeded.externalId ?? seeded.meterEventId,
      createdAt: seeded.createdAt,
      receivedAtMicros: await redisTimeMicros(),
      meterId,
      tenantId,
      amountMicrocredits: seeded.amountMicrocredits,
      status: "succeeded",
    });
    await redis.set(keys.meterBalance({ meterId, tenantId }), 50_000);

    const report = await reconcileMeterBalances();
    // No heal: the guard refuses to push the balance negative.
    expect(report.healed).toBe(0);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(50_000);

    // Keep cross-run state clean: remove the seeded inconsistency.
    await db
      .delete(meterEvents)
      .where(eq(meterEvents.meterEventId, seeded.meterEventId));
    await redis.del(keys.meterBalance({ meterId, tenantId }));
    await redis.srem(
      keys.trackedMeterBalances,
      keys.meterBalance({ meterId, tenantId }),
    );
    await db
      .delete(meterBalances)
      .where(
        and(
          eq(meterBalances.tenantId, tenantId),
          eq(meterBalances.meterId, meterId),
        ),
      );
  });

  it("heals a negative spend delta (refunds outpacing charges)", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    // Establish the pg spend checkpoint and the Redis counter.
    await rebuildMeterSpend({ meterId, tenantId });

    // A succeeded refund lands in pg after the checkpoint without touching
    // the Redis counter: the pg-derived delta is negative, which is
    // legitimate for spend (net of refunds) and must heal, not skip.
    const seeded = makeEvent({
      amountMicrocredits: -100_000,
      meterId,
      tenantId,
    });
    await db.insert(meterEvents).values({
      meterEventId: seeded.meterEventId,
      externalId: seeded.externalId ?? seeded.meterEventId,
      createdAt: seeded.createdAt,
      receivedAtMicros: await redisTimeMicros(),
      meterId,
      tenantId,
      amountMicrocredits: seeded.amountMicrocredits,
      status: "succeeded",
    });

    const report = await reconcileMeterBalances();
    expect(report.spendsHealed).toBeGreaterThanOrEqual(1);
    expect(await redis.get(keys.meterSpend({ meterId, tenantId }))).toBe(
      "-100000",
    );

    // Keep cross-run state clean.
    await db
      .delete(meterEvents)
      .where(eq(meterEvents.meterEventId, seeded.meterEventId));
    await redis.del(keys.meterSpend({ meterId, tenantId }));
    await db
      .delete(meterSpends)
      .where(
        and(
          eq(meterSpends.tenantId, tenantId),
          eq(meterSpends.meterId, meterId),
        ),
      );
  });
});
