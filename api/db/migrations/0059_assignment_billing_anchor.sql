-- Billing periods are counted from a billing anchor instead of the
-- assignment's start, so a plan change can keep the billing date. Every
-- existing assignment's billing periods were counted from its start.
ALTER TABLE "assignments" ADD COLUMN "billing_anchor_at" bigint;--> statement-breakpoint
UPDATE "assignments" SET "billing_anchor_at" = "starts_at";--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "billing_anchor_at" SET NOT NULL;--> statement-breakpoint
-- Billing periods follow the calendar now, so a billing period's length is
-- its end minus its start; the stored cycle length is no longer read.
ALTER TABLE "billing_periods" DROP COLUMN "window_ms";
