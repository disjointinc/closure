ALTER TABLE "rule_scheduler_state" RENAME COLUMN "evaluated_through_ms" TO "cursor_at_micros";--> statement-breakpoint
-- Every bookmark saved before this migration belongs to a lifecycle rule and
-- is in ms (inactive_for rules had none); the column holds µs from here on.
UPDATE "rule_scheduler_state" SET "cursor_at_micros" = "cursor_at_micros" * 1000;--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" DROP CONSTRAINT "rule_scheduler_state_rule_id_rules_rule_id_fk";
--> statement-breakpoint
DROP INDEX "assignments_started";--> statement-breakpoint
DROP INDEX "billing_periods_end";--> statement-breakpoint
DROP INDEX "invoices_finalized";--> statement-breakpoint
DROP INDEX "tenant_last_activity_meter_stale";--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" ADD COLUMN "cursor_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" ADD COLUMN "claimed_at" bigint;--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" ADD CONSTRAINT "rule_scheduler_state_rule_id_rules_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("rule_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_started" ON "assignments" USING btree ("starts_at","assignment_id");--> statement-breakpoint
CREATE INDEX "billing_periods_end" ON "billing_periods" USING btree ("period_end","assignment_id");--> statement-breakpoint
CREATE INDEX "invoices_finalized" ON "invoices" USING btree ("finalized_at","invoice_id") WHERE "invoices"."finalized_at" is not null;--> statement-breakpoint
CREATE INDEX "tenant_last_activity_meter_stale" ON "tenant_last_activity" USING btree ("meter_id","last_event_at_micros","tenant_id");