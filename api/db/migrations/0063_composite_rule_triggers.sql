-- A rule with a composite trigger keeps one scheduler bookmark per scan, so
-- a bookmark is named by its rule and scan. Existing rules have one scan,
-- named ''.
ALTER TABLE "rule_scheduler_state" ADD COLUMN "scan_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" DROP CONSTRAINT "rule_scheduler_state_pkey";--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" ADD CONSTRAINT "rule_scheduler_state_rule_id_scan_key_pk" PRIMARY KEY("rule_id","scan_key");--> statement-breakpoint
-- A lifecycle trigger now carries endOffset, which is only read inside a
-- composite trigger. Existing ones aren't inside one, so theirs is null.
UPDATE "rules" SET "trigger" = "trigger" || '{"endOffset": null}'::jsonb WHERE "trigger" ->> 'type' = 'relative_to_lifecycle_event';
