-- billing_periods.is_current becomes advanced_at: when the period after
-- this one was written (or it was settled that none comes), null while the
-- advance step still owes it. Rows that were no longer current get their
-- period_end, about when the advance step closed them, or now for any
-- written ahead that haven't ended yet.
ALTER TABLE "billing_periods" ADD COLUMN "advanced_at" bigint;--> statement-breakpoint
UPDATE "billing_periods"
SET "advanced_at" = LEAST("period_end", (extract(epoch from now()) * 1000)::bigint)
WHERE NOT "is_current";--> statement-breakpoint
DROP INDEX "billing_periods_current_end";--> statement-breakpoint
DROP INDEX "billing_periods_one_current_per_line";--> statement-breakpoint
ALTER TABLE "billing_periods" DROP COLUMN "is_current";--> statement-breakpoint
CREATE INDEX "billing_periods_unadvanced_end" ON "billing_periods" USING btree ("period_end") WHERE "billing_periods"."advanced_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_periods_one_unadvanced_per_product_line" ON "billing_periods" USING btree ("tenant_id","product_line_id") WHERE "billing_periods"."advanced_at" is null;
