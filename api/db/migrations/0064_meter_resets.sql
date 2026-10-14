-- Meter balances now change on reset: a plan's allocation is granted again,
-- and unspent credits expire. Every such move is a credit grant, credit_lots
-- tracks which credits are left from which grant, and meter_resets tracks
-- each tenant's meter. Balances from before this have no lots, so they never
-- expire.
CREATE TYPE "public"."credit_grant_kind" AS ENUM('team_member', 'allocation', 'plan_change', 'coupon', 'expiry');--> statement-breakpoint
CREATE TABLE "credit_lots" (
	"credit_lot_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"credit_grant_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"amount_microcredits" bigint NOT NULL,
	"unspent_microcredits" bigint NOT NULL,
	"expires_at" bigint,
	"expired_at" bigint,
	CONSTRAINT "credit_lot_id_format" CHECK ("credit_lots"."credit_lot_id" ~ '^credit_lot_[a-z0-9]{25}$')
);
--> statement-breakpoint
CREATE TABLE "meter_resets" (
	"tenant_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"settled_through_microseconds" bigint NOT NULL,
	"next_reset_at" bigint,
	"assignment_id" text,
	CONSTRAINT "meter_resets_tenant_id_meter_id_pk" PRIMARY KEY("tenant_id","meter_id")
);
--> statement-breakpoint
ALTER TABLE "credit_grants" DROP CONSTRAINT "credit_grants_one_grantor";--> statement-breakpoint
ALTER TABLE "credit_grants" DROP CONSTRAINT "credit_grants_amount";--> statement-breakpoint
-- Every existing credit grant came from a team member or from an
-- assignment's start, which is what its kind says from here on.
ALTER TABLE "credit_grants" ADD COLUMN "kind" "credit_grant_kind";--> statement-breakpoint
UPDATE "credit_grants" SET "kind" = CASE WHEN "by_team_member_id" IS NOT NULL THEN 'team_member'::"credit_grant_kind" ELSE 'plan_change'::"credit_grant_kind" END;--> statement-breakpoint
ALTER TABLE "credit_grants" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD COLUMN "coupon_receipt_id" text;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD COLUMN "expires_at" bigint;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD COLUMN "balance_after_microcredits" bigint;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_meter_id_meters_meter_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("meter_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_credit_grant_id_credit_grants_credit_grant_id_fk" FOREIGN KEY ("credit_grant_id") REFERENCES "public"."credit_grants"("credit_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_resets" ADD CONSTRAINT "meter_resets_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_resets" ADD CONSTRAINT "meter_resets_meter_id_meters_meter_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("meter_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_resets" ADD CONSTRAINT "meter_resets_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_lots_live" ON "credit_lots" USING btree ("tenant_id","meter_id") WHERE "credit_lots"."expired_at" is null;--> statement-breakpoint
CREATE INDEX "credit_lots_expiring" ON "credit_lots" USING btree ("expires_at") WHERE "credit_lots"."expired_at" is null and "credit_lots"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "meter_resets_due" ON "meter_resets" USING btree ("next_reset_at") WHERE "meter_resets"."next_reset_at" is not null;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_coupon_receipt_id_coupon_receipts_coupon_receipt_id_fk" FOREIGN KEY ("coupon_receipt_id") REFERENCES "public"."coupon_receipts"("coupon_receipt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_kind_variant" CHECK ((kind = 'team_member' and by_team_member_id is not null and assignment_id is null and coupon_receipt_id is null)
       or (kind in ('allocation', 'plan_change') and by_team_member_id is null and assignment_id is not null and coupon_receipt_id is null)
       or (kind = 'coupon' and by_team_member_id is null and assignment_id is null and coupon_receipt_id is not null)
       or (kind = 'expiry' and by_team_member_id is null and assignment_id is null and coupon_receipt_id is null));--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_amount" CHECK (amount_microcredits > 0 or (kind in ('plan_change', 'expiry') and amount_microcredits < 0));