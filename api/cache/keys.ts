/**
 * cache/keys.ts -- Closure's Redis key layout.
 *
 * mbal:{tenantId}:{meterId}    string  current balance in microcredits
 * midem:{tenantId}:{meterId}:{externalId}
 *                              string  idempotency marker for a meter event;
 *                                      the value is the event's outcome status
 * mev:pending                  stream  meter events awaiting batched flush to pg
 * mbal:tracked                 set     every balance key ever written; the
 *                                      checkpoint loop persists these to pg
 * mgrant:{creditGrantId}       string  idempotency marker for a credit grant
 *                                      application (exactly-once INCRBY)
 * mflush:{meterEventId}        string  flush-attempt marker; distinguishes
 *                                      "already in pg via an earlier flush"
 *                                      from "duplicate ingest double-charge"
 * mblock:{tenantId}:{meterId}  string  rebuild lock held while a missing
 *                                      balance key is rebuilt from pg
 * rwatch:{tenantId}:{meterId}  string  cached rule watch set for the
 *                                      tenant+meter (scope-resolved thresholds)
 * mspend:{tenantId}:{meterId}  string  running spend since a base checkpoint,
 *                                      in microcredits; INCRBY'd atomically
 *                                      with the balance on ingest
 * rquota:{ruleId}:{tenantId}:{windowStart}
 *                              string  firing count this window for a capped
 *                                      rule; cached from rule_runs, TTL'd to
 *                                      the window so keys die with it
 */
export const keys = {
  meterBalance: ({
    meterId,
    tenantId,
  }: {
    meterId: string;
    tenantId: string;
  }) => `mbal:${tenantId}:${meterId}`,
  meterEventIdempotency: ({
    externalId,
    meterId,
    tenantId,
  }: {
    externalId: string;
    meterId: string;
    tenantId: string;
  }) => `midem:${tenantId}:${meterId}:${externalId}`,
  pendingMeterEvents: "mev:pending",
  trackedMeterBalances: "mbal:tracked",
  meterGrantMarker: ({ creditGrantId }: { creditGrantId: string }) =>
    `mgrant:${creditGrantId}`,
  meterFlushMarker: ({ meterEventId }: { meterEventId: string }) =>
    `mflush:${meterEventId}`,
  meterBalanceRebuildLock: ({
    meterId,
    tenantId,
  }: {
    meterId: string;
    tenantId: string;
  }) => `mblock:${tenantId}:${meterId}`,
  ruleWatchSet: ({
    meterId,
    tenantId,
  }: {
    meterId: string;
    tenantId: string;
  }) => `rwatch:${tenantId}:${meterId}`,
  meterSpend: ({
    meterId,
    tenantId,
  }: {
    meterId: string;
    tenantId: string;
  }) => `mspend:${tenantId}:${meterId}`,
  ruleFiringQuota: ({
    ruleId,
    tenantId,
    windowStart,
  }: {
    ruleId: string;
    tenantId: string;
    windowStart: number;
  }) => `rquota:${ruleId}:${tenantId}:${windowStart}`,
} as const;

/**
 * How long an idempotency marker lives. The pg unique index on
 * (tenant_id, meter_id, external_id) is the permanent backstop; this window
 * just needs to comfortably cover the flush-to-pg lag plus client retries.
 */
export const METER_EVENT_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Grant-application and flush-attempt markers use the same window: both
 * only need to outlive the reconciler interval plus the longest realistic
 * client retry budget.
 */
export const METER_MARKER_TTL_MS = METER_EVENT_IDEMPOTENCY_TTL_MS;
