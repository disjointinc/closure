/**
 * cache/metering.test.ts -- integration tests for the metering cache's
 * durability machinery: rebuild-after-loss, exactly-once grants, flush
 * duplicate compensation, the DLQ, signed amounts (refunds), and external-id
 * defaulting. Reconciler tests live in reconcile.test.ts.
 *
 * Shares the scratch Postgres + throwaway Redis with reconcile.test.ts; see
 * test-helpers.ts for setup requirements. Files run sequentially
 * (api/vitest.config.ts).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/index.ts";
import { creditGrants, meterEvents, meterEventsDlq } from "../../db/schema.ts";
import { meterEventSchema } from "../../schemas/meter-event.ts";
import { redis } from "../index.ts";
import { keys } from "../keys.ts";
import {
  applyCreditGrant,
  checkpointMeterBalances,
  flushPendingMeterEvents,
  getMeterBalance,
  rebuildMeterBalance,
  recordMeterEvent,
  redisTimeMicros,
  setMeterBalance,
  stampGrantApplied,
  type MeterEventPayload,
} from "./metering.ts";
import {
  closeTestState,
  makeEvent,
  makeMeter,
  makeTeamMember,
  makeTenant,
  newCreditGrantId,
  newMeterEventId,
  newMeterId,
  newTenantId,
  pgCheckpoint,
  pgEventCount,
  resetTestState,
  suffix,
} from "../test-helpers.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

describe("metering durability", () => {
  it("rebuilds after total Redis loss with the exact balance", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    for (let i = 0; i < 3; i++) {
      const { status } = await recordMeterEvent({
        event: makeEvent({ amountMicrocredits: 100_000, meterId, tenantId }),
      });
      expect(status).toBe("succeeded");
    }
    expect(await flushPendingMeterEvents()).toBe(3);
    expect(await checkpointMeterBalances()).toBe(1);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(700_000);

    // Timestamps are on the Redis clock, in microseconds.
    const checkpoint = await pgCheckpoint({ meterId, tenantId });
    expect(checkpoint.updatedAt).toBeGreaterThan(1e15);
    const [pgEvent] = await db
      .select()
      .from(meterEvents)
      .where(eq(meterEvents.tenantId, tenantId))
      .limit(1);
    expect(pgEvent.receivedAtMicros).not.toBeNull();
    expect(pgEvent.receivedAtMicros).toBeGreaterThan(1e15);

    await redis.flushall();
    expect(await getMeterBalance({ meterId, tenantId })).toBeNull();

    // Read repair: the next event rebuilds the key from pg, then succeeds.
    const { status, balanceMicrocredits } = await recordMeterEvent({
      event: makeEvent({ amountMicrocredits: 150_000, meterId, tenantId }),
    });
    expect(status).toBe("succeeded");
    expect(balanceMicrocredits).toBe(550_000);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(550_000);

    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await pgEventCount({ tenantId })).toBe(4);
  });

  it("applies a credit grant exactly once through read repair", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    const byTeamMemberId = await makeTeamMember();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });
    await redis.flushall();

    const creditGrantId = newCreditGrantId();
    await db.insert(creditGrants).values({
      creditGrantId,
      tenantId,
      meterId,
      grantedAt: Date.now(),
      byTeamMemberId,
      reason: "test",
      amountMicrocredits: 250_000,
    });

    await expect(
      applyCreditGrant({
        grant: { amount: 250_000, creditGrantId, meterId, tenantId },
      }),
    ).resolves.toBe(1_250_000);
    // A retry (e.g. client timeout after the INCRBY) must not re-apply.
    await expect(
      applyCreditGrant({
        grant: { amount: 250_000, creditGrantId, meterId, tenantId },
      }),
    ).resolves.toBe(1_250_000);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(1_250_000);

    await stampGrantApplied({ creditGrantId });
    const [first] = await db
      .select()
      .from(creditGrants)
      .where(eq(creditGrants.creditGrantId, creditGrantId));
    expect(first.appliedAtMicros).not.toBeNull();
    expect(first.appliedAtMicros).toBeGreaterThan(1e15);
    // Stamping is once-only, so rebuild replay can never double-count.
    await stampGrantApplied({ creditGrantId });
    const [second] = await db
      .select()
      .from(creditGrants)
      .where(eq(creditGrants.creditGrantId, creditGrantId));
    expect(second.appliedAtMicros).toBe(first.appliedAtMicros);
  });

  it("compensates a duplicate ingest after marker loss at flush", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    const externalId = `ext-${suffix({ length: 16 })}`;
    const first = makeEvent({
      amountMicrocredits: 100_000,
      meterId,
      overrides: { externalId },
      tenantId,
    });
    expect((await recordMeterEvent({ event: first })).status).toBe("succeeded");
    expect(await flushPendingMeterEvents()).toBe(1);

    // Simulate Redis losing the idempotency marker, then a client retry with
    // a new id: Redis is charged a second time.
    await redis.del(
      keys.meterEventIdempotency({
        externalId,
        meterId,
        tenantId,
      }),
    );
    const retry = makeEvent({
      amountMicrocredits: 100_000,
      meterId,
      overrides: { externalId },
      tenantId,
    });
    expect((await recordMeterEvent({ event: retry })).status).toBe("succeeded");
    expect(await getMeterBalance({ meterId, tenantId })).toBe(800_000);

    // At flush, the pg unique index absorbs the duplicate; the flush sees the
    // fresh attempt marker + conflict and credits one charge back.
    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(900_000);
    expect(await pgEventCount({ tenantId })).toBe(1);
  });

  it("does NOT compensate a re-flush after a crash before stream trim", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    const event = makeEvent({ amountMicrocredits: 100_000, meterId, tenantId });
    expect((await recordMeterEvent({ event })).status).toBe("succeeded");
    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(900_000);

    // Simulate the crash-between-insert-and-XDEL window: the same entry
    // reappears on the stream (the row is already in pg).
    await redis.xadd(
      keys.pendingMeterEvents,
      "*",
      "payload",
      JSON.stringify(event),
      "status",
      "succeeded",
      "received_at",
      String(await redisTimeMicros()),
    );
    expect(await flushPendingMeterEvents()).toBe(1);

    // The pre-existing flush marker proves the single decrement was
    // legitimate: no compensation, balance unchanged, still one pg row.
    expect(await getMeterBalance({ meterId, tenantId })).toBe(900_000);
    expect(await pgEventCount({ tenantId })).toBe(1);
  });

  it("moves a poison event to the DLQ without blocking the pipeline", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    // id violates the meter_event id-format CHECK constraint; the
    // Redis ingest path doesn't validate it, so the decrement happens and
    // the flush hits 23514.
    const poison = makeEvent({
      amountMicrocredits: 200_000,
      meterId,
      overrides: { meterEventId: "meter_event_tooshort" },
      tenantId,
    });
    expect((await recordMeterEvent({ event: poison })).status).toBe(
      "succeeded",
    );
    const good = makeEvent({ amountMicrocredits: 100_000, meterId, tenantId });
    expect((await recordMeterEvent({ event: good })).status).toBe("succeeded");
    expect(await getMeterBalance({ meterId, tenantId })).toBe(700_000);

    // The batch insert fails atomically and retries; the per-row fallback
    // then lands the good row and DLQs the poison.
    expect(await flushPendingMeterEvents()).toBe(2);

    expect(await pgEventCount({ tenantId })).toBe(1);
    const dlqRows = await db
      .select()
      .from(meterEventsDlq)
      .where(eq(meterEventsDlq.tenantId, tenantId));
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0].status).toBe("succeeded");
    expect(dlqRows[0].amountMicrocredits).toBe(200_000);
    expect(dlqRows[0].error).toMatch(/^23514/);
    expect(await redis.xlen(keys.pendingMeterEvents)).toBe(0);

    // Rebuilds count DLQ'd succeeded events: the balance must come back at
    // the pre-loss value even though the event never reached meter_events.
    await redis.del(keys.meterBalance({ meterId, tenantId }));
    expect(await rebuildMeterBalance({ meterId, tenantId })).toBe(700_000);
  });

  it("initializes a never-initialized meter to zero, fail closed", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();

    const { status } = await recordMeterEvent({
      event: makeEvent({ amountMicrocredits: 100_000, meterId, tenantId }),
    });
    expect(status).toBe("insufficient_balance");
    expect(await getMeterBalance({ meterId, tenantId })).toBe(0);
    // A base checkpoint row now exists for future rebuilds.
    const checkpoint = await pgCheckpoint({ meterId, tenantId });
    expect(checkpoint.balanceMicrocredits).toBe(0);

    expect(await flushPendingMeterEvents()).toBe(1);
    const [row] = await db
      .select()
      .from(meterEvents)
      .where(eq(meterEvents.tenantId, tenantId));
    expect(row.status).toBe("insufficient_balance");
  });

  it("returns the original status on idempotent redelivery, charging once", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    const externalId = `ext-${suffix({ length: 16 })}`;
    const first = makeEvent({
      amountMicrocredits: 100_000,
      meterId,
      overrides: { externalId },
      tenantId,
    });
    const redelivery = makeEvent({
      amountMicrocredits: 100_000,
      meterId,
      overrides: { externalId },
      tenantId,
    });
    expect((await recordMeterEvent({ event: first })).status).toBe("succeeded");
    const redelivered = await recordMeterEvent({ event: redelivery });
    expect(redelivered.status).toBe("succeeded");
    // The redelivery reports the current balance without re-charging.
    expect(redelivered.balanceMicrocredits).toBe(900_000);
    expect(await getMeterBalance({ meterId, tenantId })).toBe(900_000);

    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await pgEventCount({ tenantId })).toBe(1);
  });

  it("defaults externalId to meterEventId when omitted", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    // Null externalId: the caller's first-time path.
    const event: MeterEventPayload = {
      meterEventId: newMeterEventId(),
      externalId: null,
      createdAt: Date.now(),
      meterId,
      tenantId,
      amountMicrocredits: 100_000,
    };
    expect((await recordMeterEvent({ event })).status).toBe("succeeded");
    // A redelivery with the same id (and still no external id)
    // dedupes via the default: no second charge, one pg row.
    const redelivered = await recordMeterEvent({ event });
    expect(redelivered.status).toBe("succeeded");
    expect(redelivered.balanceMicrocredits).toBe(900_000);

    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await pgEventCount({ tenantId })).toBe(1);
    const [row] = await db
      .select()
      .from(meterEvents)
      .where(eq(meterEvents.tenantId, tenantId));
    expect(row.externalId).toBe(event.meterEventId);
  });
});

describe("refunds (signed amounts)", () => {
  it("credits the balance, reports it, and replays exactly after loss", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId,
      tenantId,
    });

    const charge = await recordMeterEvent({
      event: makeEvent({ amountMicrocredits: 600_000, meterId, tenantId }),
    });
    expect(charge.status).toBe("succeeded");
    expect(charge.balanceMicrocredits).toBe(400_000);

    // A refund is a negative-amount event: no balance check, always succeeds.
    const refund = await recordMeterEvent({
      event: makeEvent({ amountMicrocredits: -200_000, meterId, tenantId }),
    });
    expect(refund.status).toBe("succeeded");
    expect(refund.balanceMicrocredits).toBe(600_000);

    expect(await flushPendingMeterEvents()).toBe(2);
    await checkpointMeterBalances();
    // The checkpoint row is what rebuild will use after the loss.
    expect(
      (await pgCheckpoint({ meterId, tenantId })).balanceMicrocredits,
    ).toBe(600_000);

    // Replay must be sign-aware: rebuild after total loss comes back exact.
    await redis.flushall();
    const { status, balanceMicrocredits } = await recordMeterEvent({
      event: makeEvent({ amountMicrocredits: 50_000, meterId, tenantId }),
    });
    expect(status).toBe("succeeded");
    expect(balanceMicrocredits).toBe(550_000);
  });

  it("succeeds on an empty (never-initialized) balance", async () => {
    const tenantId = await makeTenant();
    const meterId = await makeMeter();

    const refund = await recordMeterEvent({
      event: makeEvent({ amountMicrocredits: -50_000, meterId, tenantId }),
    });
    expect(refund.status).toBe("succeeded");
    expect(refund.balanceMicrocredits).toBe(50_000);

    // A charge larger than the refunded balance still fails closed.
    const charge = await recordMeterEvent({
      event: makeEvent({ amountMicrocredits: 100_000, meterId, tenantId }),
    });
    expect(charge.status).toBe("insufficient_balance");
    expect(charge.balanceMicrocredits).toBe(50_000);
  });

  it("rejects zero-amount events at the schema", () => {
    const parsed = meterEventSchema.safeParse({
      meterEventId: newMeterEventId(),
      externalId: "ext-zero",
      createdAt: Date.now(),
      meterId: newMeterId(),
      tenantId: newTenantId(),
      amountMicrocredits: 0,
      status: "succeeded",
    });
    expect(parsed.success).toBe(false);
  });
});
