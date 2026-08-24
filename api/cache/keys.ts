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
 */
export const keys = {
  meterBalance: (tenantId: string, meterId: string) =>
    `mbal:${tenantId}:${meterId}`,
  meterEventIdempotency: (
    tenantId: string,
    meterId: string,
    externalId: string,
  ) => `midem:${tenantId}:${meterId}:${externalId}`,
  pendingMeterEvents: "mev:pending",
  trackedMeterBalances: "mbal:tracked",
} as const;

/**
 * How long an idempotency marker lives. The pg unique index on
 * (tenant, meter, external_id) is the permanent backstop; this window just
 * needs to comfortably cover the flush-to-pg lag plus client retries.
 */
export const METER_EVENT_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
