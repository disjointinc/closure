/**
 * cache/metering.ts -- the Redis side of metering.
 *
 * Design: Redis is the hot path so a high volume of concurrent meter events
 * and balance checks never touch Postgres per-event, while pg stays the
 * durable record.
 *
 * Write path (recordMeterEvent): one atomic Lua script per event --
 *   1. dedupe on the caller's idempotency key (repeat deliveries return the
 *      original outcome without double-charging),
 *   2. check and decrement the balance (exact 64-bit integer arithmetic),
 *   3. buffer the event on a stream for batched flush to pg,
 *   4. mark the balance key as tracked for checkpointing.
 *
 * Read path (getMeterBalance): a single GET.
 *
 * Durability: flushPendingMeterEvents batch-inserts buffered events into pg
 * (idempotently -- ON CONFLICT DO NOTHING on the pg unique index), and
 * checkpointMeterBalances periodically persists balances to pg. Recovery
 * after a Redis flush: balance = meter_balances checkpoint, minus succeeded
 * meter_events with created_at after the checkpoint's updated_at.
 *
 * Accuracy notes: balance check + decrement is atomic (Lua), so concurrent
 * events can never overdraw. Checkpoints are write-behind and converge;
 * they may lag by up to a checkpoint interval.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { meterBalances, meterEvents } from "../db/schema.ts";
import type { MeterEvent } from "../schemas/meter_event.ts";
import { redis } from "./index.ts";
import { keys, METER_EVENT_IDEMPOTENCY_TTL_MS } from "./keys.ts";

type MeterEventStatus = MeterEvent["status"];

/** What the API hands us per event; the script attaches the status. */
export type MeterEventPayload = Omit<MeterEvent, "status">;

/**
 * The custom commands below are registered via defineCommand (which caches
 * the script SHA server-side) and typed here -- ioredis's RedisCommander
 * augmentation requires repeating its exact type parameters, so a local
 * cast is the cleaner way to type them.
 */
const commands = redis as unknown as {
  meterEventIngest(
    idempotencyKey: string,
    balanceKey: string,
    pendingStream: string,
    amountMicrocredits: number,
    idempotencyTtlMs: number,
    payloadJson: string,
    trackedSet: string,
  ): Promise<MeterEventStatus>;
  meterBalanceAdjust(
    balanceKey: string,
    deltaMicrocredits: number,
    trackedSet: string,
  ): Promise<number>;
  meterBalanceSet(
    balanceKey: string,
    balanceMicrocredits: number,
    trackedSet: string,
  ): Promise<number>;
};

redis.defineCommand("meterEventIngest", {
  numberOfKeys: 3,
  lua: `
    local existing = redis.call("GET", KEYS[1])
    if existing then
      return existing
    end
    local balance = tonumber(redis.call("GET", KEYS[2]) or "0")
    local amount = tonumber(ARGV[1])
    local status
    if balance < amount then
      status = "insufficient_balance"
    else
      redis.call("DECRBY", KEYS[2], amount)
      redis.call("SADD", ARGV[4], KEYS[2])
      status = "succeeded"
    end
    redis.call("SET", KEYS[1], status, "PX", ARGV[2])
    redis.call("XADD", KEYS[3], "*", "payload", ARGV[3], "status", status)
    return status
  `,
});

redis.defineCommand("meterBalanceAdjust", {
  numberOfKeys: 1,
  lua: `
    local balance = redis.call("INCRBY", KEYS[1], ARGV[1])
    redis.call("SADD", ARGV[2], KEYS[1])
    return balance
  `,
});

redis.defineCommand("meterBalanceSet", {
  numberOfKeys: 1,
  lua: `
    redis.call("SET", KEYS[1], ARGV[1])
    redis.call("SADD", ARGV[2], KEYS[1])
    return redis.call("GET", KEYS[1])
  `,
});

/**
 * Record a meter event: idempotently check and decrement the tenant's
 * balance for the meter, and buffer the event for flush to pg. Returns the
 * event's status ("succeeded" | "insufficient_balance"); a repeat delivery
 * of the same external id returns the original status without re-charging.
 */
export async function recordMeterEvent(
  event: MeterEventPayload,
): Promise<MeterEventStatus> {
  return commands.meterEventIngest(
    keys.meterEventIdempotency(
      event.tenant,
      event.meter,
      event.ideally_unique_external_id,
    ),
    keys.meterBalance(event.tenant, event.meter),
    keys.pendingMeterEvents,
    event.amount,
    METER_EVENT_IDEMPOTENCY_TTL_MS,
    JSON.stringify(event),
    keys.trackedMeterBalances,
  );
}

/** The tenant's current balance for a meter, or null if never initialized. */
export async function getMeterBalance(
  tenantId: string,
  meterId: string,
): Promise<number | null> {
  const raw = await redis.get(keys.meterBalance(tenantId, meterId));
  return raw === null ? null : Number(raw);
}

/** Add (or subtract, with negative delta) microcredits, e.g. credit grants. */
export async function adjustMeterBalance(
  tenantId: string,
  meterId: string,
  deltaMicrocredits: number,
): Promise<number> {
  return commands.meterBalanceAdjust(
    keys.meterBalance(tenantId, meterId),
    deltaMicrocredits,
    keys.trackedMeterBalances,
  );
}

/** Initialize or overwrite a balance, e.g. on plan assignment or reset. */
export async function setMeterBalance(
  tenantId: string,
  meterId: string,
  balanceMicrocredits: number,
): Promise<number> {
  return commands.meterBalanceSet(
    keys.meterBalance(tenantId, meterId),
    balanceMicrocredits,
    keys.trackedMeterBalances,
  );
}

/** How many events to flush to pg per batch. */
const FLUSH_BATCH_SIZE = 500;

/**
 * Drain pending meter events into pg in batches. Inserts are idempotent
 * (the (tenant, meter, external_id) unique index + ON CONFLICT DO NOTHING),
 * so a crash between insert and stream-trim replays harmlessly. Returns the
 * number of events flushed.
 */
export async function flushPendingMeterEvents(): Promise<number> {
  const entries = await redis.xrange(
    keys.pendingMeterEvents,
    "-",
    "+",
    "COUNT",
    FLUSH_BATCH_SIZE,
  );
  if (entries.length === 0) {
    return 0;
  }
  const rows = entries.map(([entryId, fields]) => {
    // fields: ["payload", <json>, "status", <status>] (see the Lua script).
    const event = JSON.parse(fields[1] as string) as MeterEventPayload;
    const status = fields[3] as MeterEventStatus;
    return { entryId, event, status };
  });
  await db
    .insert(meterEvents)
    .values(
      rows.map(({ event, status }) => ({
        uniqueId: event.unique_id,
        ideallyUniqueExternalId: event.ideally_unique_external_id,
        createdAt: event.created_at,
        meter: event.meter,
        tenant: event.tenant,
        amountMicrocredits: event.amount,
        status,
      })),
    )
    .onConflictDoNothing();
  await redis.xdel(keys.pendingMeterEvents, ...rows.map((row) => row.entryId));
  return rows.length;
}

/** Persist all tracked Redis balances to the meter_balances checkpoints. */
export async function checkpointMeterBalances(): Promise<number> {
  const tracked = await redis.smembers(keys.trackedMeterBalances);
  if (tracked.length === 0) {
    return 0;
  }
  const balances = await redis.mget(tracked);
  const now = Date.now();
  const rows = tracked.flatMap((key, i) => {
    const raw = balances[i];
    if (raw === null) {
      return [];
    }
    const [, tenant, meter] = key.split(":");
    return [
      { tenant, meter, balanceMicrocredits: Number(raw), updatedAt: now },
    ];
  });
  await db
    .insert(meterBalances)
    .values(rows)
    .onConflictDoUpdate({
      target: [meterBalances.tenant, meterBalances.meter],
      set: {
        balanceMicrocredits: sql`excluded.balance_microcredits`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  return rows.length;
}

/** How often buffered meter events flush to pg, and balances checkpoint. */
const FLUSH_INTERVAL_MS = 1_000;
const CHECKPOINT_INTERVAL_MS = 30_000;

/**
 * Start the background write-behind loops (event flush + balance
 * checkpoint). Intervals are unref'd and errors are logged, never thrown --
 * a transient pg hiccup must not take metering down (events stay buffered).
 */
export function startMeteringFlushLoop(): void {
  const flush = setInterval(() => {
    flushPendingMeterEvents().catch((error) =>
      console.error("meter event flush failed", error),
    );
  }, FLUSH_INTERVAL_MS);
  const checkpoint = setInterval(() => {
    checkpointMeterBalances().catch((error) =>
      console.error("meter balance checkpoint failed", error),
    );
  }, CHECKPOINT_INTERVAL_MS);
  flush.unref();
  checkpoint.unref();
}
