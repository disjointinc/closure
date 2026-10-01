-- Every event now records the balance the ingest script left. Rows flushed
-- before that are dev data only (nothing runs in production yet), so they
-- get 0 rather than staying unknown.
UPDATE "meter_events"
SET "balance_after_microcredits" = 0
WHERE "balance_after_microcredits" IS NULL;--> statement-breakpoint
ALTER TABLE "meter_events" ALTER COLUMN "balance_after_microcredits" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meter_events_dlq" ADD COLUMN "balance_after_microcredits" bigint;
