CREATE TYPE "public"."rule_backfill" AS ENUM('none', 'once_per_tenant', 'every_firing');--> statement-breakpoint
CREATE TABLE "rule_backfills" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"cursor_tenant_id" text DEFAULT '' NOT NULL,
	"next_available_at" bigint NOT NULL,
	"claimed_at" bigint,
	"completed_at" bigint
);
--> statement-breakpoint
DROP INDEX "meter_events_tenant_meter_created";--> statement-breakpoint
DROP INDEX "meter_events_meter_received";--> statement-breakpoint
DROP INDEX "rule_runs_rule_tenant_created";--> statement-breakpoint
ALTER TABLE "meter_events" ADD COLUMN "balance_after_microcredits" bigint;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD COLUMN "occurred_at" bigint;--> statement-breakpoint
-- When each existing firing's condition was met. An inactive_for firing's
-- trigger key ends with the tenant's last activity (µs), and its window
-- finished one rule duration later (months count as 30 days, as in
-- durationToMs). Every other firing was recorded the moment it was detected.
UPDATE "rule_runs" AS rr
SET "occurred_at" = CASE
  WHEN rr."payload"->>'type' = 'inactive_for' THEN
    split_part(rr."trigger_key", ':', 2)::bigint / 1000
      + coalesce(
        (r."trigger"->'duration'->>'days')::bigint * 86400000,
        (r."trigger"->'duration'->>'months')::bigint * 2592000000
      )
  ELSE rr."created_at"
END
FROM "rules" AS r
WHERE r."rule_id" = rr."rule_id";--> statement-breakpoint
ALTER TABLE "rule_runs" ALTER COLUMN "occurred_at" SET NOT NULL;--> statement-breakpoint
-- Every firing payload now carries occurredAt and backfilled. Firings marked
-- backdated were the old form of a backfilled firing.
UPDATE "rule_runs"
SET "payload" = ("payload" - 'backdated') || jsonb_build_object(
  'occurredAt', "occurred_at",
  'backfilled', coalesce(("payload"->>'backdated')::boolean, false)
);--> statement-breakpoint
-- Tasks and items keep a copy of the payload of the run that made them.
-- Their ids derive from the run's id (derivedId in cache/rule/execute.ts):
-- an item's suffix is the run's whole suffix, a task's is its first 25
-- characters.
UPDATE "tasks" AS t
SET "source_firing" = rr."payload"
FROM "rule_runs" AS rr
WHERE t."source_firing" IS NOT NULL
  AND rr."rule_id" = t."source_rule_id"
  AND substr(rr."rule_run_id", 10, 25) = substr(t."task_id", 6);--> statement-breakpoint
UPDATE "items" AS i
SET "source_firing" = rr."payload"
FROM "rule_runs" AS rr
WHERE i."source_firing" IS NOT NULL
  AND rr."rule_run_id" = 'rule_run_' || substr(i."item_id", 6);--> statement-breakpoint
-- Copies whose run is gone: the task's own creation time, or the invoice's
-- for items (which carry no timestamp of their own).
UPDATE "tasks"
SET "source_firing" = ("source_firing" - 'backdated') || jsonb_build_object(
  'occurredAt', "created_at",
  'backfilled', coalesce(("source_firing"->>'backdated')::boolean, false)
)
WHERE "source_firing" IS NOT NULL
  AND NOT ("source_firing" ? 'occurredAt');--> statement-breakpoint
UPDATE "items" AS i
SET "source_firing" = (i."source_firing" - 'backdated') || jsonb_build_object(
  'occurredAt', inv."created_at",
  'backfilled', coalesce((i."source_firing"->>'backdated')::boolean, false)
)
FROM "invoices" AS inv
WHERE inv."invoice_id" = i."invoice_id"
  AND i."source_firing" IS NOT NULL
  AND NOT (i."source_firing" ? 'occurredAt');--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "backfill" "rule_backfill" DEFAULT 'none' NOT NULL;--> statement-breakpoint
-- includeBackdated moves off the inactive_for trigger onto every rule.
-- Rules that fired for already-quiet tenants are labeled once_per_tenant,
-- unless they move money (which backfilling rules can't). No backfill job
-- starts for them: they already fired under the old behavior.
UPDATE "rules"
SET "backfill" = 'once_per_tenant'
WHERE "trigger"->>'type' = 'inactive_for'
  AND ("trigger"->>'includeBackdated')::boolean
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements("actions") AS action
    WHERE action->>'type' <> 'create_task'
  );--> statement-breakpoint
UPDATE "rules"
SET "trigger" = "trigger" - 'includeBackdated'
WHERE "trigger" ? 'includeBackdated';--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "backfill" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rule_backfills" ADD CONSTRAINT "rule_backfills_rule_id_rules_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("rule_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meter_events_meter_tenant_received" ON "meter_events" USING btree ("meter_id","tenant_id","received_at_micros");--> statement-breakpoint
CREATE INDEX "rule_runs_rule_tenant_occurred" ON "rule_runs" USING btree ("rule_id","tenant_id","occurred_at");
