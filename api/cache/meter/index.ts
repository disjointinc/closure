/**
 * cache/meter/metering.ts -- the Redis side of metering.
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
 *      INCRBYing the mspend: spend counter and GREATEST-updating the
 *      mlast: last-activity timestamp in the same atomic step,
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
 *   - meter events   -> meterEvents.receivedAtMicros  (stamped in the
 *     Lua script)
 *   - credit grants  -> creditGrants.appliedAtMicros  (NULL = never
 *     applied)
 *   - balance sets   -> meterBalances upsert      (synchronous, so the
 *     rebuild base is never lost between a Redis write and a crash)
 *   - checkpoints    -> meterBalances, write-behind on the
 *     CHECKPOINT_INTERVAL_MS cadence, guarded so a stale snapshot can never
 *     overwrite a newer set.
 * Rebuild of a lost balance key (rebuildMeterBalance):
 *   balance = meterBalances checkpoint
 *             - succeeded meterEvents (and DLQ rows)
 *               receivedAtMicros > updatedAt
 *             + credit_grants appliedAtMicros > updatedAt.
 * Only MISSING keys are rebuilt -- never overwrite a live key -- so a
 * failover that preserves partial state cannot double-count.
 *
 * The mspend: counter powers microcredits_spent rules off the pg event scan:
 * a flat Redis INCRBY on ingest, made a since-checkpoint DELTA by
 * checkpointMeterBalances (accumulated into meter_spends and reset), so
 * spend reads are a durable pg base + a Redis GET with no per-event pg scan.
 * The pre-window gap (a cycle start after the last checkpoint) is a bounded
 * pg read. Rebuild of a lost spend key (rebuildMeterSpend) restores just the
 * post-checkpoint delta; the durable base itself lives in meter_spends.
 *
 * Unlike balances, spend deliberately does not read-repair at ingest. The
 * balance Lua GETs mbal: before decrementing and returns "uninitialized"
 * when the key is absent; the caller rebuilds and retries. Mirroring that
 * for mspend: was rejected on three grounds:
 *
 *   1. Blast radius. A missing mbal: means "unknown credit balance" --
 *      ingesting anyway could hand out unbounded free usage, so balances
 *      must fail closed. A missing mspend: means a spend-threshold
 *      notification fires late once -- annoying, not dangerous -- so it
 *      doesn't justify fail-closed machinery.
 *   2. The compensating control is proportionate: the periodic reconciler
 *      (cache/meter/reconcile.ts) rebuilds missing spend keys and heals
 *      drift, bounding silent undercounting to one interval, and the
 *      startup scan (rebuildMissingMeterBalances) covers full Redis loss.
 *   3. Hot-path cost. The EXISTS check + branch would add a command to the
 *      atomic ingest script, plus a rebuild-and-retry path. Small, but the
 *      hot path is the hot path.
 *
 * The mlast: last-activity key powers the inactive_for scheduler without
 * ever scanning meter_events: ingest GREATEST-updates it with the event's
 * received_at, so staleness is an O(1) per-candidate lookup. The durable
 * copy is tenant_last_activity, checkpointed alongside balances; rebuild of
 * a lost key (rebuildLastActivity) restores the durable max, and the
 * startup scan plus the periodic reconciler cover it like the other
 * counters. It cannot read-repair at ingest (GREATEST on a missing key
 * would silently start at the first event's timestamp), same tradeoff as
 * the spend counter.
 *
 * Flush path (flushPendingMeterEvents): batched, idempotent inserts
 * (ON CONFLICT DO NOTHING on the pg unique index). Flush-attempt markers
 * (mflush:) tell "crash between insert and stream-trim" (replay harmlessly)
 * apart from "duplicate ingest double-charged Redis" (credit one charge
 * back). Rows that repeatedly fail to insert move to the meterEventsDlq
 * pg table so one poison row can't head-of-line block the stream.
 *
 * Accuracy notes: balance check + decrement is atomic (Lua), so concurrent
 * events can never overdraw. Ordering between checkpoints and event replay
 * relies on microsecond-resolution Redis TIME; identical-microsecond
 * interleavings are theoretically possible on coarse clocks. The periodic
 * reconciler (cache/meter/reconcile.ts) heals any residual drift.
 */
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  creditGrants,
  meterBalances,
  meterEvents,
  meterEventsDlq,
  meterSpends,
  tenantLastActivity,
} from "../../db/schema.ts";
import type { MeterEvent } from "../../schemas/meter-event.ts";
import { redis } from "../index.ts";
import {
  keys,
  METER_EVENT_IDEMPOTENCY_TTL_MS,
  METER_MARKER_TTL_MS,
} from "../keys.ts";

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
    spendKey: string,
    lastActivityKey: string,
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
  numberOfKeys: 5,
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
      redis.call("INCRBY", KEYS[4], amount)
      status = "succeeded"
    end
    redis.call("SET", KEYS[1], status, "PX", ARGV[2])
    local time = redis.call("TIME")
    local received_at = tonumber(time[1]) * 1000000 + tonumber(time[2])
    redis.call("XADD", KEYS[3], "*", "payload", ARGV[3], "status", status, "received_at", received_at)
    -- GREATEST-update the last-activity key: a concurrent ingest with an
    -- older timestamp never regresses it.
    local last = redis.call("GET", KEYS[5])
    if not last or received_at > tonumber(last) then
      redis.call("SET", KEYS[5], received_at)
    end
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
  readonly tenantId: string;
  readonly meterId: string;

  constructor({ meterId, tenantId }: { meterId: string; tenantId: string }) {
    super(`meter balance unavailable for ${tenantId}/${meterId}`);
    this.name = "MeterBalanceUnavailableError";
    this.tenantId = tenantId;
    this.meterId = meterId;
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
  receivedAtMicros: number | null;
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
      receivedAtMicros: null,
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
      receivedAtMicros: null,
      status: null,
    };
  }
  return {
    entryId,
    event,
    payloadJson,
    receivedAtMicros: receivedAtRaw === null ? null : Number(receivedAtRaw),
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
  /* Default the idempotency key to the event's own id so callers who don't
   * need idempotent redelivery never mint a second id. The buffered payload
   * carries the resolved value, so the flush always writes a non-null
   * external_id to pg. */
  const externalId = event.externalId ?? event.meterEventId;
  /* Ordered args: numberOfKeys: 4 on the defineCommand above splits this
   * list into KEYS (idempotency, balance, stream, spend) and ARGV (the rest). */
  const args = [
    keys.meterEventIdempotency({
      externalId,
      meterId: event.meterId,
      tenantId: event.tenantId,
    }),
    keys.meterBalance({ meterId: event.meterId, tenantId: event.tenantId }),
    keys.pendingMeterEvents,
    keys.meterSpend({ meterId: event.meterId, tenantId: event.tenantId }),
    keys.lastActivity({ meterId: event.meterId, tenantId: event.tenantId }),
    event.amountMicrocredits,
    METER_EVENT_IDEMPOTENCY_TTL_MS,
    JSON.stringify({ ...event, externalId }),
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
  await ensureMeterBalance({
    meterId: event.meterId,
    tenantId: event.tenantId,
  });
  const retry = await commands.meterEventIngest(...args);
  if (retry === "uninitialized") {
    throw new MeterBalanceUnavailableError({
      meterId: event.meterId,
      tenantId: event.tenantId,
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
      meterId,
      tenantId,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [meterBalances.tenantId, meterBalances.meterId],
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
  creditGrantId: string;
  tenantId: string;
  meterId: string;
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
    keys.meterGrantMarker({ creditGrantId: grant.creditGrantId }),
    keys.meterBalance({ meterId: grant.meterId, tenantId: grant.tenantId }),
    grant.amount,
    METER_MARKER_TTL_MS,
    keys.trackedMeterBalances,
  ] as const;
  const first = await commands.meterGrantApply(...args);
  if (first !== "uninitialized") {
    return Number(first);
  }
  await ensureMeterBalance({
    meterId: grant.meterId,
    tenantId: grant.tenantId,
  });
  const retry = await commands.meterGrantApply(...args);
  if (retry === "uninitialized") {
    throw new MeterBalanceUnavailableError({
      meterId: grant.meterId,
      tenantId: grant.tenantId,
    });
  }
  return Number(retry);
}

/**
 * Record that a grant reached the Redis balance, on the Redis clock. Stamped
 * at most once (WHERE applied_at_micros IS NULL): a later stamp could push
 * the grant past a checkpoint's updated_at and make a rebuild double-count
 * it.
 */
export async function stampGrantApplied({
  creditGrantId,
}: {
  creditGrantId: string;
}): Promise<void> {
  const at = await redisTimeMicros();
  await db
    .update(creditGrants)
    .set({ appliedAtMicros: at })
    .where(
      and(
        eq(creditGrants.creditGrantId, creditGrantId),
        isNull(creditGrants.appliedAtMicros),
      ),
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
      and(
        eq(meterBalances.tenantId, tenantId),
        eq(meterBalances.meterId, meterId),
      ),
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
          meterId,
          tenantId,
          updatedAt: await redisTimeMicros(),
        })
        .onConflictDoNothing();
    } catch (error) {
      /* The tenant/meter may not exist in pg (FK); the Redis-side zero still
       * preserves the historical fail-closed behavior for unknown meters. */
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

/**
 * Cumulative succeeded spend for one tenant+meter since `sinceMicros` (µs),
 * for microcredits_spent rules. Durable base (meter_spends checkpoint) plus
 * the pg sum of events received after it -- the flush-lag delta. Caller
 * clamps `sinceMicros` to the cycle start, so this is exactly "spend this
 * cycle" without any cycle anchor on the ingest hot path: the Redis counter
 * is flat, and the checkpoint keeps the pg sum bounded to one flush interval.
 */
export async function spendSince({
  meterId,
  sinceMicros,
  tenantId,
}: {
  meterId: string;
  sinceMicros: number;
  tenantId: string;
}): Promise<number> {
  const [checkpoint] = await db
    .select()
    .from(meterSpends)
    .where(
      and(eq(meterSpends.tenantId, tenantId), eq(meterSpends.meterId, meterId)),
    )
    .limit(1);
  const counterDelta = Number(
    (await redis.get(keys.meterSpend({ meterId, tenantId }))) ?? 0,
  );
  if (!checkpoint) {
    /* No checkpoint yet: the counter delta is the whole history. */
    return counterDelta;
  }
  /* Spend earned after the checkpoint but at or before the window start is a
   * pre-window gap that must not be counted; it's always bounded to one
   * checkpoint interval, so this pg read stays cheap and only runs when the
   * window opened after the checkpoint. */
  let preWindowGap = 0;
  if (sinceMicros > checkpoint.updatedAt) {
    preWindowGap = await sumSucceededMeterEventsBetween({
      fromMicros: checkpoint.updatedAt,
      meterId,
      tenantId,
      toMicros: sinceMicros,
    });
  }
  /* Result = durable in-window base + in-window post-checkpoint delta.
   * delta covers all post-checkpoint spend; subtract the pre-window part. */
  return checkpoint.spendMicrocredits + counterDelta - preWindowGap;
}

/**
 * Rebuild a lost spend key from pg: the checkpoint plus succeeded events
 * received after it (including the DLQ). Only call for a key MISSING from
 * Redis -- overwriting a live key could double-count.
 */
export async function rebuildMeterSpend({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<number> {
  const [checkpoint] = await db
    .select()
    .from(meterSpends)
    .where(
      and(eq(meterSpends.tenantId, tenantId), eq(meterSpends.meterId, meterId)),
    )
    .limit(1);
  /* The Redis counter is a DELTA since the last checkpoint (checkpoint()
   * accumulates it into the pg base and resets it). A lost key therefore
   * rebuilds to just the post-checkpoint pg sum; the durable base itself
   * stays in pg. Rebuild the counter to that delta, not the absolute total. */
  let spend: number;
  if (checkpoint) {
    spend = await sumSucceededMeterEvents({
      meterId,
      since: checkpoint.updatedAt,
      tenantId,
    });
  } else {
    spend = 0;
    try {
      await db
        .insert(meterSpends)
        .values({
          meterId,
          spendMicrocredits: 0,
          tenantId,
          updatedAt: await redisTimeMicros(),
        })
        .onConflictDoNothing();
    } catch (error) {
      console.error("could not persist base spend checkpoint row", {
        error,
        meterId,
        tenantId,
      });
    }
  }
  await redis.set(keys.meterSpend({ meterId, tenantId }), spend);
  console.log("rebuilt meter spend", { meterId, spend, tenantId });
  return spend;
}

/**
 * Latest event timestamp for a tenant+meter, or null if never recorded.
 * Read from the mlast: Redis key; the scheduler's staleness check never
 * touches pg when the key exists.
 */
export async function getLastActivity({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<number | null> {
  const raw = await redis.get(keys.lastActivity({ meterId, tenantId }));
  return raw === null ? null : Number(raw);
}

/**
 * Rebuild a lost last-activity key from the durable tenant_last_activity
 * row. Only call for a key MISSING from Redis -- overwriting a live key
 * could regress the max.
 */
export async function rebuildLastActivity({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<number | null> {
  const [row] = await db
    .select()
    .from(tenantLastActivity)
    .where(
      and(
        eq(tenantLastActivity.tenantId, tenantId),
        eq(tenantLastActivity.meterId, meterId),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  await redis.set(
    keys.lastActivity({ meterId, tenantId }),
    row.lastEventAtMicros,
  );
  console.log("rebuilt last activity", {
    lastEventAtMicros: row.lastEventAtMicros,
    meterId,
    tenantId,
  });
  return row.lastEventAtMicros;
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
        eq(meterEvents.tenantId, tenantId),
        eq(meterEvents.meterId, meterId),
        eq(meterEvents.status, "succeeded"),
        gt(meterEvents.receivedAtMicros, since),
      ),
    );
  const [dlq] = await db
    .select({
      total: sql<string>`coalesce(sum(${meterEventsDlq.amountMicrocredits}), 0)::bigint`,
    })
    .from(meterEventsDlq)
    .where(
      and(
        eq(meterEventsDlq.tenantId, tenantId),
        eq(meterEventsDlq.meterId, meterId),
        eq(meterEventsDlq.status, "succeeded"),
        gt(meterEventsDlq.receivedAtMicros, since),
      ),
    );
  return Number(events.total) + Number(dlq.total);
}

/**
 * Succeeded meter-event debits in the half-open range (fromMicros, toMicros]
 * (µs), including the DLQ. Used to measure the pre-window gap between a spend
 * checkpoint and a later cycle start.
 */
export async function sumSucceededMeterEventsBetween({
  fromMicros,
  meterId,
  tenantId,
  toMicros,
}: {
  fromMicros: number;
  meterId: string;
  tenantId: string;
  toMicros: number;
}): Promise<number> {
  const [events] = await db
    .select({
      total: sql<string>`coalesce(sum(${meterEvents.amountMicrocredits}), 0)::bigint`,
    })
    .from(meterEvents)
    .where(
      and(
        eq(meterEvents.tenantId, tenantId),
        eq(meterEvents.meterId, meterId),
        eq(meterEvents.status, "succeeded"),
        gt(meterEvents.receivedAtMicros, fromMicros),
        lte(meterEvents.receivedAtMicros, toMicros),
      ),
    );
  const [dlq] = await db
    .select({
      total: sql<string>`coalesce(sum(${meterEventsDlq.amountMicrocredits}), 0)::bigint`,
    })
    .from(meterEventsDlq)
    .where(
      and(
        eq(meterEventsDlq.tenantId, tenantId),
        eq(meterEventsDlq.meterId, meterId),
        eq(meterEventsDlq.status, "succeeded"),
        gt(meterEventsDlq.receivedAtMicros, fromMicros),
        lte(meterEventsDlq.receivedAtMicros, toMicros),
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
        eq(creditGrants.tenantId, tenantId),
        eq(creditGrants.meterId, meterId),
        gt(creditGrants.appliedAtMicros, since),
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
      meterId,
      tenantId,
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

/** Per-kind counts from the startup missing-key rebuild. */
export type RebuildMissingReport = {
  activityRebuilt: number;
  balancesRebuilt: number;
  spendsRebuilt: number;
};

/**
 * Startup reconciliation: rebuild every pg-checkpointed balance, spend
 * counter, or last-activity key whose Redis key is missing. Covers
 * whole-fleet Redis loss (flush, failover without state) without waiting
 * for per-key read repair -- which spend and last-activity counters never
 * get, since their ingest INCRBY/GREATEST succeeds on a missing key.
 */
export async function rebuildMissingMeterBalances(): Promise<RebuildMissingReport> {
  const balanceRows = await db
    .select({
      tenantId: meterBalances.tenantId,
      meterId: meterBalances.meterId,
    })
    .from(meterBalances);
  let balancesRebuilt = 0;
  for (const row of balanceRows) {
    if (
      await redis.exists(
        keys.meterBalance({ meterId: row.meterId, tenantId: row.tenantId }),
      )
    ) {
      continue;
    }
    await rebuildMeterBalance({ meterId: row.meterId, tenantId: row.tenantId });
    balancesRebuilt += 1;
  }
  if (balancesRebuilt > 0) {
    console.log(`rebuilt ${balancesRebuilt} missing meter balance(s)`);
  }
  const spendRows = await db
    .select({
      tenantId: meterSpends.tenantId,
      meterId: meterSpends.meterId,
    })
    .from(meterSpends);
  let spendsRebuilt = 0;
  for (const row of spendRows) {
    if (
      await redis.exists(
        keys.meterSpend({ meterId: row.meterId, tenantId: row.tenantId }),
      )
    ) {
      continue;
    }
    await rebuildMeterSpend({ meterId: row.meterId, tenantId: row.tenantId });
    spendsRebuilt += 1;
  }
  if (spendsRebuilt > 0) {
    console.log(`rebuilt ${spendsRebuilt} missing meter spend(s)`);
  }
  const activityRows = await db
    .select({
      tenantId: tenantLastActivity.tenantId,
      meterId: tenantLastActivity.meterId,
    })
    .from(tenantLastActivity);
  let activityRebuilt = 0;
  for (const row of activityRows) {
    if (
      await redis.exists(
        keys.lastActivity({ meterId: row.meterId, tenantId: row.tenantId }),
      )
    ) {
      continue;
    }
    await rebuildLastActivity({ meterId: row.meterId, tenantId: row.tenantId });
    activityRebuilt += 1;
  }
  if (activityRebuilt > 0) {
    console.log(`rebuilt ${activityRebuilt} missing last-activity key(s)`);
  }
  return { activityRebuilt, balancesRebuilt, spendsRebuilt };
}

/**
 * How many events to flush to pg per batch. One factor in the drain
 * ceiling -- see FLUSH_DRAIN_BATCHES_PER_TICK.
 */
const FLUSH_BATCH_SIZE = 500;
/** Batch-insert attempts before falling back to per-row inserts. */
const FLUSH_BATCH_ATTEMPTS = 3;
const FLUSH_RETRY_BACKOFF_MS = [250, 1_000];

/**
 * Drain pending meter events into pg in batches. Inserts are idempotent
 * (the (tenant_id, meter_id, external_id) unique index + ON CONFLICT DO
 * NOTHING).
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
          keys.meterFlushMarker({ meterEventId: row.event.meterEventId }),
        ),
      )
    : [];
  const firstAttemptById = new Map(
    parseable.map((row, i) => [row.event.meterEventId, marks[i] === 1]),
  );

  const state = new Map<string, "inserted" | "conflict" | "poison" | "pending">(
    parseable.map((row) => [row.event.meterEventId, "pending"]),
  );
  const values = parseable.map((row) => ({
    meterEventId: row.event.meterEventId,
    /* Ingest resolves this before buffering; the fallback covers entries
     * buffered by other means (e.g. hand-repaired streams). */
    externalId: row.event.externalId ?? row.event.meterEventId,
    createdAt: row.event.createdAt,
    receivedAtMicros: row.receivedAtMicros,
    meterId: row.event.meterId,
    tenantId: row.event.tenantId,
    amountMicrocredits: row.event.amountMicrocredits,
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
          .returning({ meterEventId: meterEvents.meterEventId });
        const insertedIds = new Set(inserted.map((row) => row.meterEventId));
        for (const value of values) {
          state.set(
            value.meterEventId,
            insertedIds.has(value.meterEventId) ? "inserted" : "conflict",
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
    /* One poison row fails the whole (atomic) batch insert; go row-by-row so
     * good rows still land and only the poison goes to the DLQ. */
    for (const [i, value] of values.entries()) {
      try {
        const inserted = await db
          .insert(meterEvents)
          .values(value)
          .onConflictDoNothing()
          .returning({ meterEventId: meterEvents.meterEventId });
        state.set(
          value.meterEventId,
          inserted.length === 1 ? "inserted" : "conflict",
        );
      } catch (error) {
        const code = pgErrorCode({ error });
        if (code === null) {
          // pg itself is down, not the row: stop and leave the rest buffered.
          console.error("meter event flush lost pg mid-batch", error);
          break;
        }
        state.set(value.meterEventId, "poison");
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
    const rowState = state.get(row.event.meterEventId);
    if (rowState !== "inserted" && rowState !== "conflict") {
      // "pending" rows (pg lost mid-batch) stay on the stream for next tick.
      continue;
    }
    doneEntryIds.push(row.entryId);
    const isDuplicateIngest =
      rowState === "conflict" &&
      row.status === "succeeded" &&
      firstAttemptById.get(row.event.meterEventId) === true;
    if (isDuplicateIngest) {
      compensations.push(row);
    }
  }
  for (const row of compensations) {
    const { amountMicrocredits, meterId, tenantId } = row.event;
    const externalId = row.event.externalId ?? row.event.meterEventId;
    const balanceKey = keys.meterBalance({ meterId, tenantId });
    /* Only credit back if the key still holds the duplicate charge; a key
     * lost and rebuilt since is already correct from pg. */
    if (await redis.exists(balanceKey)) {
      await redis.incrby(balanceKey, amountMicrocredits);
      await redis.incrby(
        keys.meterSpend({ meterId, tenantId }),
        -amountMicrocredits,
      );
      console.error("compensated duplicate meter event charge", {
        amountMicrocredits,
        externalId,
        meterId,
        tenantId,
      });
    }
    // Re-warm the Redis idempotency marker so later retries short-circuit.
    await redis.set(
      keys.meterEventIdempotency({
        externalId,
        meterId,
        tenantId,
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
          tenantId: row.event?.tenantId ?? null,
          meterId: row.event?.meterId ?? null,
          amountMicrocredits: row.event?.amountMicrocredits ?? null,
          receivedAtMicros: row.receivedAtMicros,
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
  /* Balances come from one snapshot (clock + every value in the same
   * instant). Spend deltas are captured with GETSET (atomic read-and-zero),
   * so an INCRBY can never land between a snapshot and a reset and be
   * swallowed from the delta. Last-activity keys are monotonic (GREATEST on
   * ingest), so a plain GETSET-like read plus a max-guard upsert is enough. */
  const spendKeys = tracked.map((key) => {
    const [, tenantId, meterId] = key.split(":");
    return keys.meterSpend({ meterId, tenantId });
  });
  const activityKeys = tracked.map((key) => {
    const [, tenantId, meterId] = key.split(":");
    return keys.lastActivity({ meterId, tenantId });
  });
  const snapshot = await commands.meterCheckpointSnapshot(
    ...tracked,
    ...activityKeys,
  );
  const updatedAt = Number(snapshot[0]) * 1_000_000 + Number(snapshot[1]);
  const spendDeltas = await Promise.all(
    spendKeys.map((key) => redis.getset(key, 0)),
  );
  const rows = tracked.flatMap((key, i) => {
    const raw = snapshot[i + 2];
    if (raw === null) {
      return [];
    }
    const [, tenantId, meterId] = key.split(":");
    return [{ tenantId, meterId, balanceMicrocredits: Number(raw), updatedAt }];
  });
  const spendRows = spendKeys.flatMap((key, i) => {
    const raw = spendDeltas[i];
    if (raw === null) {
      return [];
    }
    const [, tenantId, meterId] = key.split(":");
    return [{ tenantId, meterId, spendMicrocredits: Number(raw), updatedAt }];
  });
  const activityRows = activityKeys.flatMap((key, i) => {
    const raw = snapshot[tracked.length + i + 2];
    if (raw === null) {
      return [];
    }
    const [, tenantId, meterId] = key.split(":");
    return [{ tenantId, meterId, lastEventAtMicros: Number(raw) }];
  });
  if (rows.length === 0) {
    return 0;
  }
  await db
    .insert(meterBalances)
    .values(rows)
    .onConflictDoUpdate({
      target: [meterBalances.tenantId, meterBalances.meterId],
      set: {
        balanceMicrocredits: sql`excluded.balance_microcredits`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${meterBalances.updatedAt} <= excluded.updated_at`,
    });
  if (spendRows.length > 0) {
    await db
      .insert(meterSpends)
      .values(spendRows)
      .onConflictDoUpdate({
        target: [meterSpends.tenantId, meterSpends.meterId],
        set: {
          /* Accumulate: the snapshotted counter is a delta since the last
           * checkpoint, so the new base is old base + delta. */
          spendMicrocredits: sql`${meterSpends.spendMicrocredits} + excluded.spend_microcredits`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: sql`${meterSpends.updatedAt} <= excluded.updated_at`,
      });
  }
  if (activityRows.length > 0) {
    await db
      .insert(tenantLastActivity)
      .values(activityRows)
      .onConflictDoUpdate({
        target: [tenantLastActivity.tenantId, tenantLastActivity.meterId],
        set: {
          lastEventAtMicros: sql`excluded.last_event_at_micros`,
        },
        /* GREATEST semantics: a stale checkpoint snapshot can never move the
         * durable max backwards. */
        setWhere: sql`${tenantLastActivity.lastEventAtMicros} < excluded.last_event_at_micros`,
      });
  }
  return rows.length;
}

/** How often buffered meter events flush to pg, and balances checkpoint. */
const FLUSH_INTERVAL_MS = 1_000;
const CHECKPOINT_INTERVAL_MS = 30_000;
/**
 * Flush batches per tick, bounding how long one tick can monopolize the loop.
 *
 * Drain ceiling: at most FLUSH_BATCH_SIZE x FLUSH_DRAIN_BATCHES_PER_TICK
 * events reach pg per FLUSH_INTERVAL_MS, per API process -- each replica
 * runs its own loop, so replicas multiply the ceiling. The ceiling is
 * global across all tenants and meters (one shared mev:pending stream) and
 * bounds only the write-behind: ingest is uncapped, so sustained excess
 * just grows the stream backlog. To lift it, raise FLUSH_BATCH_SIZE and/or
 * FLUSH_DRAIN_BATCHES_PER_TICK; the next constraints are pg-side (per-row
 * index/FK maintenance on meter_events, then server tuning).
 */
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
