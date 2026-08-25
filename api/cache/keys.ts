/**
 * cache/keys.ts -- Closure's Redis key layout.
 *
 * mbal:{tenant}:{meter}      string  current balance in microcredits
 * midem:{tenant}:{meter}:{externalId}
 *                            string  idempotency marker for a meter event;
 *                                    the value is the event's outcome status
 * mev:pending                stream  meter events awaiting batched flush to pg
 * mbal:tracked               set     every balance key ever written; the
 *                                    checkpoint loop persists these to pg
 * mgrant:{grantId}           string  idempotency marker for a credit grant
 *                                    application (exactly-once INCRBY)
 * mflush:{meterEventId}      string  flush-attempt marker; distinguishes
 *                                    "already in pg via an earlier flush"
 *                                    from "duplicate ingest double-charge"
 * mblock:{tenant}:{meter}    string  rebuild lock held while a missing
 *                                    balance key is rebuilt from pg
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
  meterGrantMarker: ({ grantId }: { grantId: string }) => `mgrant:${grantId}`,
  meterFlushMarker: ({ meterEventId }: { meterEventId: string }) =>
    `mflush:${meterEventId}`,
  meterBalanceRebuildLock: ({
    meterId,
    tenantId,
  }: {
    meterId: string;
    tenantId: string;
  }) => `mblock:${tenantId}:${meterId}`,
} as const;

/**
 * How long an idempotency marker lives. The pg unique index on
 * (tenant, meter, external_id) is the permanent backstop; this window just
 * needs to comfortably cover the flush-to-pg lag plus client retries.
 */
export const METER_EVENT_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Grant-application and flush-attempt markers use the same window: both
 * only need to outlive the reconciler interval plus the longest realistic
 * client retry budget.
 */
export const METER_MARKER_TTL_MS = METER_EVENT_IDEMPOTENCY_TTL_MS;
