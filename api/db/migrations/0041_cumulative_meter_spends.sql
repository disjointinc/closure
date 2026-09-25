-- meter_spends rows switch from "base + reset-delta" to "cumulative at
-- updated_at" (the mspend: Redis counter is never reset anymore). Recompute
-- every row from the durable event log, which is the source of truth.
--
-- Redis side: existing mspend:* keys hold the old delta values and must be
-- deleted so the new rebuild path repopulates them from these rows:
--   redis-cli --scan --pattern 'mspend:*' | xargs -L1 redis-cli unlink
-- (no-op on fresh environments, where no such keys exist).
UPDATE meter_spends ms
SET spend_microcredits = coalesce((
  SELECT sum(amount_microcredits) FROM (
    SELECT amount_microcredits FROM meter_events
    WHERE tenant_id = ms.tenant_id AND meter_id = ms.meter_id
      AND status = 'succeeded' AND received_at_micros <= ms.updated_at
    UNION ALL
    SELECT amount_microcredits FROM meter_events_dlq
    WHERE tenant_id = ms.tenant_id AND meter_id = ms.meter_id
      AND status = 'succeeded' AND received_at_micros <= ms.updated_at
  ) events
), 0);
