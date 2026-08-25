/**
 * cache/metering.test.ts -- integration tests for the metering cache's
 * durability machinery: rebuild-after-loss, exactly-once grants, flush
 * duplicate compensation, the DLQ, signed amounts (refunds), and external-id
 * defaulting. Reconciler tests live in reconcile.test.ts.
 *
 * Shares the scratch Postgres + throwaway Redis with reconcile.test.ts; see
 * test_helpers.ts for setup requirements. Files run sequentially
 * (api/vitest.config.ts).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.ts";
import { creditGrants, meterEvents, meterEventsDlq } from "../db/schema.ts";
import { meterEventSchema } from "../schemas/meter_event.ts";
import { redis } from "./index.ts";
import { keys } from "./keys.ts";
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
} from "./test-helpers.ts";

beforeAll(resetTestState);
afterAll(closeTestState);

describe("metering durability", () => {
  it("rebuilds after total Redis loss with the exact balance", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    for (let i = 0; i < 3; i++) {
      const { status } = await recordMeterEvent({
        event: makeEvent({ amount: 100_000, meter, tenant }),
      });
      expect(status).toBe("succeeded");
    }
    expect(await flushPendingMeterEvents()).toBe(3);
    expect(await checkpointMeterBalances()).toBe(1);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      700_000,
    );

    // Timestamps are on the Redis clock, in microseconds.
    const checkpoint = await pgCheckpoint({ meter, tenant });
    expect(checkpoint.updatedAt).toBeGreaterThan(1e15);
    const [pgEvent] = await db
      .select()
      .from(meterEvents)
      .where(eq(meterEvents.tenant, tenant))
      .limit(1);
    expect(pgEvent.receivedAt).not.toBeNull();
    expect(pgEvent.receivedAt).toBeGreaterThan(1e15);

    await redis.flushall();
    expect(
      await getMeterBalance({ meterId: meter, tenantId: tenant }),
    ).toBeNull();

    // Read repair: the next event rebuilds the key from pg, then succeeds.
    const { status, balanceMicrocredits } = await recordMeterEvent({
      event: makeEvent({ amount: 150_000, meter, tenant }),
    });
    expect(status).toBe("succeeded");
    expect(balanceMicrocredits).toBe(550_000);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      550_000,
    );

    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await pgEventCount({ tenant })).toBe(4);
  });

  it("applies a credit grant exactly once through read repair", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    const by = await makeTeamMember();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });
    await redis.flushall();

    const grantId = newCreditGrantId();
    await db.insert(creditGrants).values({
      uniqueId: grantId,
      tenant,
      meter,
      on: Date.now(),
      byTeamMember: by,
      reason: "test",
      amountMicrocredits: 250_000,
    });

    await expect(
      applyCreditGrant({
        grant: { amount: 250_000, meter, tenant, uniqueId: grantId },
      }),
    ).resolves.toBe(1_250_000);
    // A retry (e.g. client timeout after the INCRBY) must not re-apply.
    await expect(
      applyCreditGrant({
        grant: { amount: 250_000, meter, tenant, uniqueId: grantId },
      }),
    ).resolves.toBe(1_250_000);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      1_250_000,
    );

    await stampGrantApplied({ grantId });
    const [first] = await db
      .select()
      .from(creditGrants)
      .where(eq(creditGrants.uniqueId, grantId));
    expect(first.appliedAt).not.toBeNull();
    expect(first.appliedAt).toBeGreaterThan(1e15);
    // Stamping is once-only, so rebuild replay can never double-count.
    await stampGrantApplied({ grantId });
    const [second] = await db
      .select()
      .from(creditGrants)
      .where(eq(creditGrants.uniqueId, grantId));
    expect(second.appliedAt).toBe(first.appliedAt);
  });

  it("compensates a duplicate ingest after marker loss at flush", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    const uniqueExternalId = `ext-${suffix({ length: 16 })}`;
    const first = makeEvent({
      amount: 100_000,
      meter,
      overrides: { unique_external_id: uniqueExternalId },
      tenant,
    });
    expect((await recordMeterEvent({ event: first })).status).toBe("succeeded");
    expect(await flushPendingMeterEvents()).toBe(1);

    // Simulate Redis losing the idempotency marker, then a client retry with
    // a new unique_id: Redis is charged a second time.
    await redis.del(
      keys.meterEventIdempotency({
        uniqueExternalId,
        meterId: meter,
        tenantId: tenant,
      }),
    );
    const retry = makeEvent({
      amount: 100_000,
      meter,
      overrides: { unique_external_id: uniqueExternalId },
      tenant,
    });
    expect((await recordMeterEvent({ event: retry })).status).toBe("succeeded");
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      800_000,
    );

    // At flush, the pg unique index absorbs the duplicate; the flush sees the
    // fresh attempt marker + conflict and credits one charge back.
    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      900_000,
    );
    expect(await pgEventCount({ tenant })).toBe(1);
  });

  it("does NOT compensate a re-flush after a crash before stream trim", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    const event = makeEvent({ amount: 100_000, meter, tenant });
    expect((await recordMeterEvent({ event })).status).toBe("succeeded");
    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      900_000,
    );

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
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      900_000,
    );
    expect(await pgEventCount({ tenant })).toBe(1);
  });

  it("moves a poison event to the DLQ without blocking the pipeline", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    // unique_id violates the meter_event id-format CHECK constraint; the
    // Redis ingest path doesn't validate it, so the decrement happens and
    // the flush hits 23514.
    const poison = makeEvent({
      amount: 200_000,
      meter,
      overrides: { unique_id: "meter_event_tooshort" },
      tenant,
    });
    expect((await recordMeterEvent({ event: poison })).status).toBe(
      "succeeded",
    );
    const good = makeEvent({ amount: 100_000, meter, tenant });
    expect((await recordMeterEvent({ event: good })).status).toBe("succeeded");
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      700_000,
    );

    // The batch insert fails atomically and retries; the per-row fallback
    // then lands the good row and DLQs the poison.
    expect(await flushPendingMeterEvents()).toBe(2);

    expect(await pgEventCount({ tenant })).toBe(1);
    const dlqRows = await db
      .select()
      .from(meterEventsDlq)
      .where(eq(meterEventsDlq.tenant, tenant));
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0].status).toBe("succeeded");
    expect(dlqRows[0].amountMicrocredits).toBe(200_000);
    expect(dlqRows[0].error).toMatch(/^23514/);
    expect(await redis.xlen(keys.pendingMeterEvents)).toBe(0);

    // Rebuilds count DLQ'd succeeded events: the balance must come back at
    // the pre-loss value even though the event never reached meter_events.
    await redis.del(keys.meterBalance({ meterId: meter, tenantId: tenant }));
    expect(
      await rebuildMeterBalance({ meterId: meter, tenantId: tenant }),
    ).toBe(700_000);
  });

  it("initializes a never-initialized meter to zero, fail closed", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();

    const { status } = await recordMeterEvent({
      event: makeEvent({ amount: 100_000, meter, tenant }),
    });
    expect(status).toBe("insufficient_balance");
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(0);
    // A base checkpoint row now exists for future rebuilds.
    const checkpoint = await pgCheckpoint({ meter, tenant });
    expect(checkpoint.balanceMicrocredits).toBe(0);

    expect(await flushPendingMeterEvents()).toBe(1);
    const [row] = await db
      .select()
      .from(meterEvents)
      .where(eq(meterEvents.tenant, tenant));
    expect(row.status).toBe("insufficient_balance");
  });

  it("returns the original status on idempotent redelivery, charging once", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    const externalId = `ext-${suffix({ length: 16 })}`;
    const first = makeEvent({
      amount: 100_000,
      meter,
      overrides: { unique_external_id: externalId },
      tenant,
    });
    const redelivery = makeEvent({
      amount: 100_000,
      meter,
      overrides: { unique_external_id: externalId },
      tenant,
    });
    expect((await recordMeterEvent({ event: first })).status).toBe("succeeded");
    const redelivered = await recordMeterEvent({ event: redelivery });
    expect(redelivered.status).toBe("succeeded");
    // The redelivery reports the current balance without re-charging.
    expect(redelivered.balanceMicrocredits).toBe(900_000);
    expect(await getMeterBalance({ meterId: meter, tenantId: tenant })).toBe(
      900_000,
    );

    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await pgEventCount({ tenant })).toBe(1);
  });

  it("defaults unique_external_id to unique_id when omitted", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    // No unique_external_id: the caller's first-time path.
    const event: MeterEventPayload = {
      unique_id: newMeterEventId(),
      created_at: Date.now(),
      meter,
      tenant,
      amount: 100_000,
    };
    expect((await recordMeterEvent({ event })).status).toBe("succeeded");
    // A redelivery with the same unique_id (and still no external id)
    // dedupes via the default: no second charge, one pg row.
    const redelivered = await recordMeterEvent({ event });
    expect(redelivered.status).toBe("succeeded");
    expect(redelivered.balanceMicrocredits).toBe(900_000);

    expect(await flushPendingMeterEvents()).toBe(1);
    expect(await pgEventCount({ tenant })).toBe(1);
    const [row] = await db
      .select()
      .from(meterEvents)
      .where(eq(meterEvents.tenant, tenant));
    expect(row.uniqueExternalId).toBe(event.unique_id);
  });
});

describe("refunds (signed amounts)", () => {
  it("credits the balance, reports it, and replays exactly after loss", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();
    await setMeterBalance({
      balanceMicrocredits: 1_000_000,
      meterId: meter,
      tenantId: tenant,
    });

    const charge = await recordMeterEvent({
      event: makeEvent({ amount: 600_000, meter, tenant }),
    });
    expect(charge.status).toBe("succeeded");
    expect(charge.balanceMicrocredits).toBe(400_000);

    // A refund is a negative-amount event: no balance check, always succeeds.
    const refund = await recordMeterEvent({
      event: makeEvent({ amount: -200_000, meter, tenant }),
    });
    expect(refund.status).toBe("succeeded");
    expect(refund.balanceMicrocredits).toBe(600_000);

    expect(await flushPendingMeterEvents()).toBe(2);
    await checkpointMeterBalances();
    // The checkpoint row is what rebuild will use after the loss.
    expect((await pgCheckpoint({ meter, tenant })).balanceMicrocredits).toBe(
      600_000,
    );

    // Replay must be sign-aware: rebuild after total loss comes back exact.
    await redis.flushall();
    const { status, balanceMicrocredits } = await recordMeterEvent({
      event: makeEvent({ amount: 50_000, meter, tenant }),
    });
    expect(status).toBe("succeeded");
    expect(balanceMicrocredits).toBe(550_000);
  });

  it("succeeds on an empty (never-initialized) balance", async () => {
    const tenant = await makeTenant();
    const meter = await makeMeter();

    const refund = await recordMeterEvent({
      event: makeEvent({ amount: -50_000, meter, tenant }),
    });
    expect(refund.status).toBe("succeeded");
    expect(refund.balanceMicrocredits).toBe(50_000);

    // A charge larger than the refunded balance still fails closed.
    const charge = await recordMeterEvent({
      event: makeEvent({ amount: 100_000, meter, tenant }),
    });
    expect(charge.status).toBe("insufficient_balance");
    expect(charge.balanceMicrocredits).toBe(50_000);
  });

  it("rejects zero-amount events at the schema", () => {
    const parsed = meterEventSchema.safeParse({
      unique_id: newMeterEventId(),
      unique_external_id: "ext-zero",
      created_at: Date.now(),
      meter: newMeterId(),
      tenant: newTenantId(),
      amount: 0,
      status: "succeeded",
    });
    expect(parsed.success).toBe(false);
  });
});
