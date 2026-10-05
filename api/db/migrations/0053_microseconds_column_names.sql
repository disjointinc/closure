-- Times are in ms unless their name says otherwise: spell out the
-- microsecond columns. No data changes.
ALTER TABLE "meter_events" RENAME COLUMN "received_at_micros" TO "received_at_microseconds";--> statement-breakpoint
ALTER TABLE "meter_events_dlq" RENAME COLUMN "received_at_micros" TO "received_at_microseconds";--> statement-breakpoint
ALTER TABLE "credit_grants" RENAME COLUMN "applied_at_micros" TO "applied_at_microseconds";--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" RENAME COLUMN "cursor_at_micros" TO "cursor_at_microseconds";--> statement-breakpoint
ALTER TABLE "tenant_last_activity" RENAME COLUMN "last_event_at_micros" TO "last_event_at_microseconds";--> statement-breakpoint
ALTER TABLE "meter_balances" RENAME COLUMN "updated_at" TO "updated_at_microseconds";--> statement-breakpoint
ALTER TABLE "meter_spends" RENAME COLUMN "updated_at" TO "updated_at_microseconds";
