DROP INDEX "rule_runs_pending";--> statement-breakpoint
ALTER TABLE "rule_runs" ADD COLUMN "claimed_at" bigint;--> statement-breakpoint
CREATE INDEX "rule_runs_pending" ON "rule_runs" USING btree ("available_at") WHERE "rule_runs"."succeeded_at" is null and "rule_runs"."failed_at" is null;