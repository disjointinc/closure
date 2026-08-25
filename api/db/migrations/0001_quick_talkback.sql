CREATE TABLE "meter_events_dlq" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "meter_events_dlq_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payload" text NOT NULL,
	"status" "meter_event_status",
	"tenant" text,
	"meter" text,
	"amount_microcredits" bigint,
	"received_at" bigint,
	"error" text NOT NULL,
	"failed_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_grants" ADD COLUMN "applied_at" bigint;--> statement-breakpoint
ALTER TABLE "meter_events" ADD COLUMN "received_at" bigint;--> statement-breakpoint
-- Balance checkpoints, event received_at and grant applied_at now share the
-- Redis server's clock in MICROseconds (see schema.ts). Convert existing
-- checkpoint timestamps from ms so replay comparisons stay on one scale.
UPDATE "meter_balances" SET "updated_at" = "updated_at" * 1000;