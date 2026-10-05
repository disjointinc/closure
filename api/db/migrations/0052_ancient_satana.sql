-- Every event is stamped with its received time at ingest. Rows flushed
-- before that are dev data only (nothing runs in production yet), so they
-- take their creation time, the closest record of when they arrived, in the
-- µs this column stores.
UPDATE "meter_events"
SET "received_at_micros" = "created_at" * 1000
WHERE "received_at_micros" IS NULL;--> statement-breakpoint
ALTER TABLE "meter_events" ALTER COLUMN "received_at_micros" SET NOT NULL;
