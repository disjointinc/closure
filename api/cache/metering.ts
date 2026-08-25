/**
 * cache/metering.ts -- the Redis side of metering.
 *
 * Design: Redis is the hot path so a high volume of concurrent meter events
 * and balance checks never touch Postgres per-event, while pg stays the
 * durable record from which any lost balance key can be rebuilt exactly.
 *
 * Write path (recordMeterEvent): one atomic Lua script per event --
 *   1. dedupe on the caller's idempotency key (repeat deliveries return the
 *      original outcome without double-charging),
 *   2. check and decrement the balance (exact integer arithmetic; amounts
 *      are signed -- a negative amount is a refund and always succeeds),
 *   3. buffer the event on a stream for batched flush to pg, stamped with
 *      received_at on the Redis server's clock,
 *   4. mark the balance key as tracked for checkpointing.
 * A missing balance key yields "uninitialized" (nothing is written); the
 * caller then rebuilds the key from pg and retries once (read repair).
 *
 * Read path (getMeterBalance): a single GET.
 *
 * Durability: every Redis balance mutation has a durable pg record stamped
 * on the Redis server's clock, in MICROseconds (one clock, so replay
 * ordering is exact):
 *   - meter events   -> meter_events.received_at   (stamped in the Lua script)
 *   - credit grants  -> credit_grants.applied_at   (NULL = never applied)
 *   - balance sets   -> meter_balances upsert      (synchronous, so the
 *     rebuild base is never lost between a Redis write and a crash)
 *   - checkpoints    -> meter_balances, write-behind on the
 *     CHECKPOINT_INTERVAL_MS cadence, guarded so a stale snapshot can never
 *     overwrite a newer set.
 * Rebuild of a lost balance key (rebuildMeterBalance):
 *   balance = meter_balances checkpoint
 *             - succeeded meter_events (and DLQ rows) received_at > updated_at
 *             + credit_grants applied_at > updated_at.
 * Only MISSING keys are rebuilt -- never overwrite a live key -- so a
 * failover that preserves partial state cannot double-count.
 *
 * Flush path (flushPendingMeterEvents): batched, idempotent inserts
 * (ON CONFLICT DO NOTHING on the pg unique index). Flush-attempt markers
 * (mflush:) tell "crash between insert and stream-trim" (replay harmlessly)
 * apart from "duplicate ingest double-charged Redis" (credit one charge
 * back). Rows that repeatedly fail to insert move to the meter_events_dlq
 * pg table so one poison row can't head-of-line block the stream.
 *
 * Accuracy notes: balance check + decrement is atomic (Lua), so concurrent
 * events can never overdraw. Ordering between checkpoints and event replay
 * relies on microsecond-resolution Redis TIME; identical-microsecond
 * interleavings are theoretically possible on coarse clocks. The periodic
 * reconciler (cache/reconcile.ts) heals any residual drift.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  creditGrants,
  meterBalances,
  meterEvents,
  meterEventsDlq,
} from "../db/schema.ts";
import type { MeterEvent } from "../schemas/meter_event.ts";
import { redis } from "./index.ts";
import {
  keys,
  METER_EVENT_IDEMPOTENCY_TTL_MS,
  METER_MARKER_TTL_MS,
} from "./keys.ts";

type MeterEventStatus = MeterEvent["status"];

/** What the API hands us per event; the script attaches the status. */
export type MeterEventPayload = Omit<MeterEvent, "status">;

/**
 * Ingest outcome: "uninitialized" -- transport-only (never written to Redis
 * markers, the stream, or pg) -- meaning the balance key is absent and must
 * be rebuilt before retrying. Otherwise a [status, balance] pair: the
 * event's persisted status and the post-decision balance (null only on a
 * redelivery whose balance key has since been lost).
 */
type IngestResult =
  "uninitialized" | [status: MeterEventStatus, balance: string | null];

/** The settled outcome of a recorded meter event. */
export type RecordedMeterEvent = {
  status: MeterEventStatus;
  balanceMicrocredits: number | null;
};

/**
 * The custom commands below are registered via defineCommand (which caches
 * the script SHA server-side) and typed here -- ioredis's RedisCommander
 * augmentation requires repeating its exact type parameters, so a local
 * cast is the cleaner way to type them. Their arguments stay ordered:
 * numberOfKeys splits them positionally into the script's KEYS and ARGV.
 *
 * meterCheckpointSnapshot and meterFlushMark take their keys via ARGV
 * (numberOfKeys: 0): fine on a single-node Redis, not cluster-slot-safe.
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
  ): Promise<IngestResult>;
  meterBalanceAdjust(
    balanceKey: string,
    deltaMicrocredits: number,
    trackedSet: string,
  ): Promise<number>;
  meterBalanceSet(
    balanceKey: string,
    balanceMicrocredits: number,
    trackedSet: string,
  ): Promise<string>;
  meterGrantApply(
    markerKey: string,
    balanceKey: string,
    amountMicrocredits: number,
    markerTtlMs: number,
    trackedSet: string,
  ): Promise<number | "uninitialized">;
  meterCheckpointSnapshot(...balanceKeys: string[]): Promise<(string | null)[]>;
  meterFlushMark(ttlMs: number, ...markerKeys: string[]): Promise<number[]>;
};

redis.defineCommand("meterEventIngest", {
  numberOfKeys: 3,
  lua: `
    local existing = redis.call("GET", KEYS[1])
    if existing then
      return {existing, redis.call("GET", KEYS[2])}
    end
    local raw = redis.call("GET", KEYS[2])
    if not raw then
      return "uninitialized"
    end
    local balance = tonumber(raw)
    local amount = tonumber(ARGV[1])
    local status
    if amount >= 0 and balance < amount then
      status = "insufficient_balance"
    else
      balance = redis.call("DECRBY", KEYS[2], amount)
      redis.call("SADD", ARGV[4], KEYS[2])
      status = "succeeded"
    end
    redis.call("SET", KEYS[1], status, "PX", ARGV[2])
    local time = redis.call("TIME")
    local received_at = tonumber(time[1]) * 1000000 + tonumber(time[2])
    redis.call("XADD", KEYS[3], "*", "payload", ARGV[3], "status", status, "received_at", received_at)
    return {status, balance}
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
 * Apply a credit grant exactly once: the mgrant: marker dedupes retries
 * (crash anywhere in the grant flow is safely retriable). Signals
 * "uninitialized" -- writing nothing -- when the balance key is absent, so
 * the caller can read-repair first. An already-applied grant just returns
 * the current balance.
 */
redis.defineCommand("meterGrantApply", {
  numberOfKeys: 2,
  lua: `
    if redis.call("EXISTS", KEYS[2]) == 0 then
      return "uninitialized"
    end
    if redis.call("SET", KEYS[1], "1", "NX", "PX", ARGV[2]) then
      local balance = redis.call("INCRBY", KEYS[2], ARGV[1])
      redis.call("SADD", ARGV[3], KEYS[2])
      return balance
    end
    return tonumber(redis.call("GET", KEYS[2]))
  `,
});

/** Atomically read the server clock and every tracked balance. */
redis.defineCommand("meterCheckpointSnapshot", {
  numberOfKeys: 0,
  lua: `
    local time = redis.call("TIME")
    local out = {time[1], time[2]}
    for i = 1, #ARGV do
      out[#out + 1] = redis.call("GET", ARGV[i])
    end
    return out
  `,
});

/** Mark flush attempts (SET NX); returns 1/0 per marker (1 = first attempt). */
redis.defineCommand("meterFlushMark", {
  numberOfKeys: 0,
  lua: `
    local out = {}
    for i = 2, #ARGV do
      if redis.call("SET", ARGV[i], "1", "NX", "PX", ARGV[1]) then
        out[#out + 1] = 1
      else
        out[#out + 1] = 0
      end
    end
    return out
  `,
});

/** The Redis server's clock, in microseconds since the epoch. */
export async function redisTimeMicros(): Promise<number> {
  const [seconds, micros] = await redis.time();
  return Number(seconds) * 1_000_000 + Number(micros);
}

/** The balance key is missing and read-repair could not restore it. */
export class MeterBalanceUnavailableError extends Error {
  readonly tenant: string;
  readonly meter: string;

  constructor({ meter, tenant }: { meter: string; tenant: string }) {
    super(`meter balance unavailable for ${tenant}/${meter}`);
    this.name = "MeterBalanceUnavailableError";
    this.tenant = tenant;
    this.meter = meter;
  }
}

function sleep({ ms }: { ms: number }): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Error-cause chains are user-controlled in theory; bound the walk. */
const ERROR_CAUSE_MAX_DEPTH = 10;

/**
 * Walk the cause chain for a Postgres error code (drizzle wraps postgres-js
 * errors, so the code is never on the top-level error).
 */
function pgErrorCode({ error }: { error: unknown }): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < ERROR_CAUSE_MAX_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) {
      return null;
    }
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    if (!("cause" in current)) {
      return null;
    }
    current = current.cause;
  }
  return null;
}

/**
 * One entry read off the pending stream. Either event and status are both
 * present, or the entry is poison (nulls) headed for the DLQ.
 */
type PendingRow = {
  entryId: string;
  payloadJson: string;
  receivedAt: number | null;
} & (
  | { event: MeterEventPayload; status: MeterEventStatus }
  | { event: null; status: null }
);

type ParsedRow = Extract<PendingRow, { event: MeterEventPayload }>;

/**
 * Parse one stream entry's flat field array (["payload", json, "status",
 * status, "received_at", µs]; received_at is absent on entries buffered
 * before it was introduced). Unparseable or incomplete entries come back as
 * poison (event/status null) and are DLQ'd by the flush.
 */
export function parsePendingEntry({
  entryId,
  fields,
}: {
  entryId: string;
  fields: string[];
}): PendingRow {
  const fieldMap = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    fieldMap.set(fields[i], fields[i + 1]);
  }
  const payloadJson = fieldMap.get("payload") ?? null;
  const receivedAtRaw = fieldMap.get("received_at") ?? null;
  const statusRaw = fieldMap.get("status") ?? null;
  const status =
    statusRaw === "succeeded" ||
    statusRaw === "insufficient_balance" ||
    statusRaw === "unexpected_error"
      ? statusRaw
      : null;
  if (payloadJson === null || status === null) {
    return {
      entryId,
      event: null,
      payloadJson: payloadJson ?? "",
      receivedAt: null,
      status: null,
    };
  }
  let event: MeterEventPayload | null = null;
  try {
    event = JSON.parse(payloadJson);
  } catch (error) {
    console.error("could not parse pending meter event payload", {
      entryId,
      error,
    });
  }
  if (event === null) {
    return {
      entryId,
      event: null,
      payloadJson,
      receivedAt: null,
      status: null,
    };
  }
  return {
    entryId,
    event,
    payloadJson,
    receivedAt: receivedAtRaw === null ? null : Number(receivedAtRaw),
    status,
  };
}

/**
 * Record a meter event: idempotently check and decrement the tenant's
 * balance for the meter, and buffer the event for flush to pg. Amounts are
 * signed -- a negative amount is a refund (no balance check; always
 * succeeds). A repeat delivery of the same external id returns the original
 * status without re-charging. A missing balance key is rebuilt from pg first
 * (read repair); if it cannot be restored, throws
 * MeterBalanceUnavailableError (fail closed).
 */
export async function recordMeterEvent({
  event,
}: {
  event: MeterEventPayload;
}): Promise<RecordedMeterEvent> {
  // Ordered args: numberOfKeys: 3 on the defineCommand above splits this
  // list into KEYS (idempotency, balance, stream) and ARGV (the rest).
  const args = [
    keys.meterEventIdempotency({
      externalId: event.ideally_unique_external_id,
      meterId: event.meter,
      tenantId: event.tenant,
    }),
    keys.meterBalance({ meterId: event.meter, tenantId: event.tenant }),
    keys.pendingMeterEvents,
    event.amount,
    METER_EVENT_IDEMPOTENCY_TTL_MS,
    JSON.stringify(event),
    keys.trackedMeterBalances,
  ] as const;
  const first = await commands.meterEventIngest(...args);
  if (first !== "uninitialized") {
    const [status, balance] = first;
    return {
      balanceMicrocredits: balance === null ? null : Number(balance),
      status,
    };
  }
  await ensureMeterBalance({ meterId: event.meter, tenantId: event.tenant });
  const retry = await commands.meterEventIngest(...args);
  if (retry === "uninitialized") {
    throw new MeterBalanceUnavailableError({
      meter: event.meter,
      tenant: event.tenant,
    });
  }
  const [status, balance] = retry;
  return {
    balanceMicrocredits: balance === null ? null : Number(balance),
    status,
  };
}

/** The tenant's current balance for a meter, or null if never initialized. */
export async function getMeterBalance({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<number | null> {
  const raw = await redis.get(keys.meterBalance({ meterId, tenantId }));
  return raw === null ? null : Number(raw);
}

/** Add (or subtract, with negative delta) microcredits, e.g. drift heals. */
export async function adjustMeterBalance({
  deltaMicrocredits,
  meterId,
  tenantId,
}: {
  deltaMicrocredits: number;
  meterId: string;
  tenantId: string;
}): Promise<number> {
  return commands.meterBalanceAdjust(
    keys.meterBalance({ meterId, tenantId }),
    deltaMicrocredits,
    keys.trackedMeterBalances,
  );
}

/**
 * Initialize or overwrite a balance, e.g. on plan assignment or reset.
 * Writes the pg checkpoint row first (guarded so a stale checkpoint can't
 * overwrite it): that row is the rebuild base if the Redis key is lost
 * before the next checkpoint pass.
 */
export async function setMeterBalance({
  balanceMicrocredits,
  meterId,
  tenantId,
}: {
  balanceMicrocredits: number;
  meterId: string;
  tenantId: string;
}): Promise<number> {
  const at = await redisTimeMicros();
  await db
    .insert(meterBalances)
    .values({
      balanceMicrocredits,
      meter: meterId,
      tenant: tenantId,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [meterBalances.tenant, meterBalances.meter],
      set: {
        balanceMicrocredits: sql`excluded.balance_microcredits`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${meterBalances.updatedAt} <= excluded.updated_at`,
    });
  return Number(
    await commands.meterBalanceSet(
      keys.meterBalance({ meterId, tenantId }),
      balanceMicrocredits,
      keys.trackedMeterBalances,
    ),
  );
}

export type CreditGrantApplication = {
  uniqueId: string;
  tenant: string;
  meter: string;
  amount: number;
};

/**
 * Apply a credit grant to the Redis balance, exactly once (the mgrant:
 * marker dedupes). Read-repairs a missing balance key first; a grant on a
 * never-initialized meter initializes it to 0 and then applies, preserving
 * the historical behavior of INCRBY-on-missing.
 */
export async function applyCreditGrant({
  grant,
}: {
  grant: CreditGrantApplication;
}): Promise<number> {
  // Ordered args: see the comment on recordMeterEvent.
  const args = [
    keys.meterGrantMarker({ grantId: grant.uniqueId }),
    keys.meterBalance({ meterId: grant.meter, tenantId: grant.tenant }),
    grant.amount,
    METER_MARKER_TTL_MS,
    keys.trackedMeterBalances,
  ] as const;
  const first = await commands.meterGrantApply(...args);
  if (first !== "uninitialized") {
    return Number(first);
  }
  await ensureMeterBalance({ meterId: grant.meter, tenantId: grant.tenant });
  const retry = await commands.meterGrantApply(...args);
  if (retry === "uninitialized") {
    throw new MeterBalanceUnavailableError({
      meter: grant.meter,
      tenant: grant.tenant,
    });
  }
  return Number(retry);
}

/**
 * Record that a grant reached the Redis balance, on the Redis clock. Stamped
 * at most once (WHERE applied_at IS NULL): a later stamp could push the grant
 * past a checkpoint's updated_at and make a rebuild double-count it.
 */
export async function stampGrantApplied({
  grantId,
}: {
  grantId: string;
}): Promise<void> {
  const at = await redisTimeMicros();
  await db
    .update(creditGrants)
    .set({ appliedAt: at })
    .where(
      and(eq(creditGrants.uniqueId, grantId), isNull(creditGrants.appliedAt)),
    );
}

/**
 * Rebuild a lost balance key from pg: the checkpoint, minus succeeded meter
 * events (including DLQ'd ones) received after it, plus grants applied after
 * it. With no checkpoint row the meter was never initialized: start at zero
 * and persist a base row so future rebuilds have one. Only call this for
 * keys that are MISSING from Redis -- overwriting a live key could
 * double-count mutations already reflected in it.
 */
export async function rebuildMeterBalance({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<number> {
  const [checkpoint] = await db
    .select()
    .from(meterBalances)
    .where(
      and(eq(meterBalances.tenant, tenantId), eq(meterBalances.meter, meterId)),
    )
    .limit(1);
  let balance: number;
  if (checkpoint) {
    const since = checkpoint.updatedAt;
    const eventsTotal = await sumSucceededMeterEvents({
      meterId,
      since,
      tenantId,
    });
    const grantsTotal = await sumAppliedGrants({ meterId, since, tenantId });
    balance = checkpoint.balanceMicrocredits - eventsTotal + grantsTotal;
  } else {
    balance = 0;
    try {
      await db
        .insert(meterBalances)
        .values({
          balanceMicrocredits: 0,
          meter: meterId,
          tenant: tenantId,
          updatedAt: await redisTimeMicros(),
        })
        .onConflictDoNothing();
    } catch (error) {
      // The tenant/meter may not exist in pg (FK); the Redis-side zero still
      // preserves the historical fail-closed behavior for unknown meters.
      console.error("could not persist base checkpoint row", {
        error,
        meterId,
        tenantId,
      });
    }
  }
  if (balance < 0) {
    console.error("rebuilt negative meter balance", {
      balance,
      meterId,
      tenantId,
    });
  }
  await commands.meterBalanceSet(
    keys.meterBalance({ meterId, tenantId }),
    balance,
    keys.trackedMeterBalances,
  );
  console.log("rebuilt meter balance", { balance, meterId, tenantId });
  return balance;
}

/** Succeeded meter-event debits after `since` (µs), including the DLQ. */
export async function sumSucceededMeterEvents({
  meterId,
  since,
  tenantId,
}: {
  meterId: string;
  since: number;
  tenantId: string;
}): Promise<number> {
  const [events] = await db
    .select({
      total: sql<string>`coalesce(sum(${meterEvents.amountMicrocredits}), 0)::bigint`,
    })
    .from(meterEvents)
    .where(
      and(
        eq(meterEvents.tenant, tenantId),
        eq(meterEvents.meter, meterId),
        eq(meterEvents.status, "succeeded"),
        gt(meterEvents.receivedAt, since),
      ),
    );
  const [dlq] = await db
    .select({
      total: sql<string>`coalesce(sum(${meterEventsDlq.amountMicrocredits}), 0)::bigint`,
    })
    .from(meterEventsDlq)
    .where(
      and(
        eq(meterEventsDlq.tenant, tenantId),
        eq(meterEventsDlq.meter, meterId),
        eq(meterEventsDlq.status, "succeeded"),
        gt(meterEventsDlq.receivedAt, since),
      ),
    );
  return Number(events.total) + Number(dlq.total);
}

/** Grants applied to the Redis balance after `since` (µs). */
export async function sumAppliedGrants({
  meterId,
  since,
  tenantId,
}: {
  meterId: string;
  since: number;
  tenantId: string;
}): Promise<number> {
  const [grants] = await db
    .select({
      total: sql<string>`coalesce(sum(${creditGrants.amountMicrocredits}), 0)::bigint`,
    })
    .from(creditGrants)
    .where(
      and(
        eq(creditGrants.tenant, tenantId),
        eq(creditGrants.meter, meterId),
        gt(creditGrants.appliedAt, since),
      ),
    );
  return Number(grants.total);
}

const REBUILD_LOCK_TTL_MS = 5_000;
const REBUILD_WAIT_MS = 3_000;
const REBUILD_POLL_INTERVAL_MS = 50;

/**
 * Ensure the balance key exists in Redis, rebuilding it from pg under a
 * per-key lock if it doesn't. Callers that lose the lock race wait briefly
 * for the in-flight rebuild, then fail closed (MeterBalanceUnavailableError).
 */
async function ensureMeterBalance({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<void> {
  const balanceKey = keys.meterBalance({ meterId, tenantId });
  if (await redis.exists(balanceKey)) {
    return;
  }
  const lockKey = keys.meterBalanceRebuildLock({ meterId, tenantId });
  const acquired = await redis.set(
    lockKey,
    "1",
    "PX",
    REBUILD_LOCK_TTL_MS,
    "NX",
  );
  if (!acquired) {
    for (
      let waitedMs = 0;
      waitedMs < REBUILD_WAIT_MS;
      waitedMs += REBUILD_POLL_INTERVAL_MS
    ) {
      await sleep({ ms: REBUILD_POLL_INTERVAL_MS });
      if (await redis.exists(balanceKey)) {
        return;
      }
    }
    throw new MeterBalanceUnavailableError({
      meter: meterId,
      tenant: tenantId,
    });
  }
  try {
    // The winner of a previous lock race may have rebuilt while we waited.
    if (await redis.exists(balanceKey)) {
      return;
    }
    await rebuildMeterBalance({ meterId, tenantId });
  } finally {
    await redis.del(lockKey);
  }
}

/**
 * Startup reconciliation: rebuild every pg-checkpointed balance whose Redis
 * key is missing. Covers whole-fleet Redis loss (flush, failover without
 * state) without waiting for per-key read repair.
 */
export async function rebuildMissingMeterBalances(): Promise<number> {
  const rows = await db
    .select({ tenant: meterBalances.tenant, meter: meterBalances.meter })
    .from(meterBalances);
  let rebuilt = 0;
  for (const row of rows) {
    if (
      await redis.exists(
        keys.meterBalance({ meterId: row.meter, tenantId: row.tenant }),
      )
    ) {
      continue;
    }
    await rebuildMeterBalance({ meterId: row.meter, tenantId: row.tenant });
    rebuilt += 1;
  }
  if (rebuilt > 0) {
    console.log(`rebuilt ${rebuilt} missing meter balance(s)`);
  }
  return rebuilt;
}

/** How many events to flush to pg per batch. */
const FLUSH_BATCH_SIZE = 500;
/** Batch-insert attempts before falling back to per-row inserts. */
const FLUSH_BATCH_ATTEMPTS = 3;
const FLUSH_RETRY_BACKOFF_MS = [250, 1_000];

/**
 * Drain pending meter events into pg in batches. Inserts are idempotent
 * (the (tenant, meter, external_id) unique index + ON CONFLICT DO NOTHING).
 *
 * A conflict with a flush-attempt marker WE set means the pg row came from a
 * different ingest of the same external id (Redis idempotency marker lost +
 * client retry), so Redis was charged twice -- credit one charge back. A
 * conflict with a pre-existing marker means an earlier flush inserted the row
 * and crashed before the trim -- replay harmlessly, no compensation.
 *
 * Rows that fail every insert attempt move to the meter_events_dlq pg table
 * (durable, and counted by balance rebuilds) before being trimmed, so one
 * poison row can't head-of-line block the stream. Returns the number of
 * stream entries fully handled.
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
  const rows = entries.map(([entryId, fields]) =>
    parsePendingEntry({ entryId, fields }),
  );
  const poisoned: { row: PendingRow; error: string }[] = rows
    .filter((row) => row.event === null)
    .map((row) => ({ row, error: "unparseable or incomplete payload" }));
  const parseable = rows.filter((row): row is ParsedRow => row.event !== null);

  const marks = parseable.length
    ? await commands.meterFlushMark(
        METER_MARKER_TTL_MS,
        ...parseable.map((row) =>
          keys.meterFlushMarker({ meterEventId: row.event.unique_id }),
        ),
      )
    : [];
  const firstAttemptById = new Map(
    parseable.map((row, i) => [row.event.unique_id, marks[i] === 1]),
  );

  const state = new Map<string, "inserted" | "conflict" | "poison" | "pending">(
    parseable.map((row) => [row.event.unique_id, "pending"]),
  );
  const values = parseable.map((row) => ({
    uniqueId: row.event.unique_id,
    ideallyUniqueExternalId: row.event.ideally_unique_external_id,
    createdAt: row.event.created_at,
    receivedAt: row.receivedAt,
    meter: row.event.meter,
    tenant: row.event.tenant,
    amountMicrocredits: row.event.amount,
    status: row.status,
  }));

  let batchFailed = false;
  if (values.length > 0) {
    for (let attempt = 0; attempt < FLUSH_BATCH_ATTEMPTS; attempt++) {
      try {
        const inserted = await db
          .insert(meterEvents)
          .values(values)
          .onConflictDoNothing()
          .returning({ uniqueId: meterEvents.uniqueId });
        const insertedIds = new Set(inserted.map((row) => row.uniqueId));
        for (const value of values) {
          state.set(
            value.uniqueId,
            insertedIds.has(value.uniqueId) ? "inserted" : "conflict",
          );
        }
        batchFailed = false;
        break;
      } catch (error) {
        batchFailed = true;
        console.error("meter event batch flush failed", error);
        if (attempt < FLUSH_RETRY_BACKOFF_MS.length) {
          await sleep({ ms: FLUSH_RETRY_BACKOFF_MS[attempt] });
        }
      }
    }
  }
  if (batchFailed) {
    // One poison row fails the whole (atomic) batch insert; go row-by-row so
    // good rows still land and only the poison goes to the DLQ.
    for (const [i, value] of values.entries()) {
      try {
        const inserted = await db
          .insert(meterEvents)
          .values(value)
          .onConflictDoNothing()
          .returning({ uniqueId: meterEvents.uniqueId });
        state.set(
          value.uniqueId,
          inserted.length === 1 ? "inserted" : "conflict",
        );
      } catch (error) {
        const code = pgErrorCode({ error });
        if (code === null) {
          // pg itself is down, not the row: stop and leave the rest buffered.
          console.error("meter event flush lost pg mid-batch", error);
          break;
        }
        state.set(value.uniqueId, "poison");
        poisoned.push({
          row: parseable[i],
          error: `${code}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  const doneEntryIds: string[] = [];
  const compensations: ParsedRow[] = [];
  for (const row of parseable) {
    const rowState = state.get(row.event.unique_id);
    if (rowState !== "inserted" && rowState !== "conflict") {
      // "pending" rows (pg lost mid-batch) stay on the stream for next tick.
      continue;
    }
    doneEntryIds.push(row.entryId);
    const isDuplicateIngest =
      rowState === "conflict" &&
      row.status === "succeeded" &&
      firstAttemptById.get(row.event.unique_id) === true;
    if (isDuplicateIngest) {
      compensations.push(row);
    }
  }

  for (const row of compensations) {
    const {
      amount,
      ideally_unique_external_id: externalId,
      meter,
      tenant,
    } = row.event;
    const balanceKey = keys.meterBalance({ meterId: meter, tenantId: tenant });
    // Only credit back if the key still holds the duplicate charge; a key
    // lost and rebuilt since is already correct from pg.
    if (await redis.exists(balanceKey)) {
      await redis.incrby(balanceKey, amount);
      console.error("compensated duplicate meter event charge", {
        amount,
        externalId,
        meter,
        tenant,
      });
    }
    // Re-warm the Redis idempotency marker so later retries short-circuit.
    await redis.set(
      keys.meterEventIdempotency({
        externalId,
        meterId: meter,
        tenantId: tenant,
      }),
      "succeeded",
      "PX",
      METER_EVENT_IDEMPOTENCY_TTL_MS,
    );
  }

  if (poisoned.length > 0) {
    try {
      await db.insert(meterEventsDlq).values(
        poisoned.map(({ row, error }) => ({
          payload: row.payloadJson,
          status: row.status,
          tenant: row.event?.tenant ?? null,
          meter: row.event?.meter ?? null,
          amountMicrocredits: row.event?.amount ?? null,
          receivedAt: row.receivedAt,
          error,
          failedAt: Date.now(),
        })),
      );
      doneEntryIds.push(...poisoned.map(({ row }) => row.entryId));
      console.error("moved poison meter events to DLQ", {
        count: poisoned.length,
      });
    } catch (error) {
      // pg is down: leave the entries buffered for the next tick.
      console.error("meter event DLQ insert failed", error);
    }
  }

  if (doneEntryIds.length > 0) {
    await redis.xdel(keys.pendingMeterEvents, ...doneEntryIds);
  }
  return doneEntryIds.length;
}

/**
 * Persist all tracked Redis balances to the meter_balances checkpoints. The
 * snapshot (clock + every balance) is one atomic Lua call so updated_at and
 * the values share an instant; the guarded upsert keeps a stale snapshot
 * from overwriting a newer row written by setMeterBalance.
 */
export async function checkpointMeterBalances(): Promise<number> {
  const tracked = await redis.smembers(keys.trackedMeterBalances);
  if (tracked.length === 0) {
    return 0;
  }
  const snapshot = await commands.meterCheckpointSnapshot(...tracked);
  const updatedAt = Number(snapshot[0]) * 1_000_000 + Number(snapshot[1]);
  const rows = tracked.flatMap((key, i) => {
    const raw = snapshot[i + 2];
    if (raw === null) {
      return [];
    }
    const [, tenant, meter] = key.split(":");
    return [{ tenant, meter, balanceMicrocredits: Number(raw), updatedAt }];
  });
  if (rows.length === 0) {
    return 0;
  }
  await db
    .insert(meterBalances)
    .values(rows)
    .onConflictDoUpdate({
      target: [meterBalances.tenant, meterBalances.meter],
      set: {
        balanceMicrocredits: sql`excluded.balance_microcredits`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${meterBalances.updatedAt} <= excluded.updated_at`,
    });
  return rows.length;
}

/** How often buffered meter events flush to pg, and balances checkpoint. */
const FLUSH_INTERVAL_MS = 1_000;
const CHECKPOINT_INTERVAL_MS = 30_000;
/** Flush batches per tick, bounding how long one tick can monopolize the loop. */
const FLUSH_DRAIN_BATCHES_PER_TICK = 10;

/**
 * Start the background write-behind loops (event flush + balance
 * checkpoint). The flush tick drains until a short batch (up to
 * FLUSH_DRAIN_BATCHES_PER_TICK batches) so a burst over FLUSH_BATCH_SIZE/s
 * can't build a permanent backlog. Intervals are unref'd and errors are
 * logged, never thrown -- a transient pg hiccup must not take metering down
 * (events stay buffered).
 */
export function startMeteringFlushLoop(): void {
  const flush = setInterval(() => {
    (async () => {
      for (let i = 0; i < FLUSH_DRAIN_BATCHES_PER_TICK; i++) {
        if ((await flushPendingMeterEvents()) < FLUSH_BATCH_SIZE) {
          break;
        }
      }
    })().catch((error) => console.error("meter event flush failed", error));
  }, FLUSH_INTERVAL_MS);
  const checkpoint = setInterval(() => {
    checkpointMeterBalances().catch((error) =>
      console.error("meter balance checkpoint failed", error),
    );
  }, CHECKPOINT_INTERVAL_MS);
  flush.unref();
  checkpoint.unref();
}
