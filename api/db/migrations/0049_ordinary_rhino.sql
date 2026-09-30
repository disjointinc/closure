ALTER TABLE "items" ADD COLUMN "source_rule_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "source_firing" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_firing" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_rule_id_rules_rule_id_fk" FOREIGN KEY ("source_rule_id") REFERENCES "public"."rules"("rule_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing inactive_for rules keep firing for tenants who were already quiet
-- when the rule was created: the behavior before includeBackdated existed.
UPDATE "rules"
SET "trigger" = "trigger" || '{"includeBackdated": true}'::jsonb
WHERE "trigger"->>'type' = 'inactive_for'
  AND "trigger"->'includeBackdated' IS NULL;--> statement-breakpoint
-- Mark existing inactive_for firings. A firing is backdated when the
-- tenant's inactivity window (last activity + the rule's duration) finished
-- before the rule was created. The last activity (µs) is the trigger key's
-- suffix; months count as 30 days, as in durationToMs.
UPDATE "rule_runs" AS rr
SET "payload" = rr."payload" || jsonb_build_object(
  'backdated',
  split_part(rr."trigger_key", ':', 2)::bigint / 1000
    + coalesce(
      (r."trigger"->'duration'->>'days')::bigint * 86400000,
      (r."trigger"->'duration'->>'months')::bigint * 2592000000
    )
    < r."created_at"
)
FROM "rules" AS r
WHERE r."rule_id" = rr."rule_id"
  AND rr."payload"->>'type' = 'inactive_for'
  AND rr."payload"->'backdated' IS NULL;
