-- Closure creates each billing period's invoice: upfront cycles' when the
-- billing period starts, arrears cycles' when it ends.
ALTER TABLE "billing_periods" ADD COLUMN "invoice_due_at" bigint;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD COLUMN "invoiced_at" bigint;--> statement-breakpoint
UPDATE "billing_periods"
SET "invoice_due_at" = CASE WHEN "cycles"."charged" = 'upfront' THEN "billing_periods"."period_start" ELSE "billing_periods"."period_end" END
FROM "assignments", "cycles"
WHERE "assignments"."assignment_id" = "billing_periods"."assignment_id"
  AND "cycles"."cycle_id" = "assignments"."cycle_id";--> statement-breakpoint
-- Billing periods already due were invoiced by hand, if at all; Closure
-- only invoices those that come due from now on.
UPDATE "billing_periods"
SET "invoiced_at" = (extract(epoch from now()) * 1000)::bigint
WHERE "invoice_due_at" <= (extract(epoch from now()) * 1000)::bigint;--> statement-breakpoint
ALTER TABLE "billing_periods" ALTER COLUMN "invoice_due_at" SET NOT NULL;--> statement-breakpoint
-- Credits for unused time are items with negative units.
ALTER TABLE "items" DROP CONSTRAINT "items_units_nonnegative";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billing_period_start" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "finalizes_at" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_at" bigint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "assignment_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "service_period_start" bigint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "service_period_end" bigint;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_periods_uninvoiced" ON "billing_periods" USING btree ("invoice_due_at") WHERE "billing_periods"."invoiced_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_per_billing_period" ON "invoices" USING btree ("tenant_id","product_line_id","billing_period_start") WHERE "invoices"."billing_period_start" is not null;--> statement-breakpoint
CREATE INDEX "invoices_finalizing" ON "invoices" USING btree ("finalizes_at") WHERE "invoices"."finalized_at" is null and "invoices"."finalizes_at" is not null;--> statement-breakpoint
CREATE INDEX "items_invoice" ON "items" USING btree ("invoice_id");
