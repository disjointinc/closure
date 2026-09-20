-- The table was renamed from add_on_prices long ago; Postgres keeps the original constraint name.
ALTER TABLE "add_on_type_prices" DROP CONSTRAINT "add_on_prices_value_id_values_value_id_fk";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_per_unit_value_id_values_value_id_fk";--> statement-breakpoint
ALTER TABLE "plan_prices" DROP CONSTRAINT "plan_prices_value_id_values_value_id_fk";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_value_id_values_value_id_fk";--> statement-breakpoint
ALTER TABLE "add_on_type_prices" ADD COLUMN "amounts" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "per_unit_amounts" jsonb;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD COLUMN "amounts" jsonb;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "amounts" jsonb;--> statement-breakpoint
-- Backfill the new columns from the values rows the dropped FKs pointed at.
UPDATE "add_on_type_prices" p SET "amounts" = v."amounts" FROM "values" v WHERE p."value_id" = v."value_id";--> statement-breakpoint
UPDATE "items" i SET "per_unit_amounts" = v."amounts" FROM "values" v WHERE i."per_unit_value_id" = v."value_id";--> statement-breakpoint
UPDATE "plan_prices" p SET "amounts" = v."amounts" FROM "values" v WHERE p."value_id" = v."value_id";--> statement-breakpoint
UPDATE "refunds" r SET "amounts" = v."amounts" FROM "values" v WHERE r."value_id" = v."value_id";--> statement-breakpoint
ALTER TABLE "add_on_type_prices" ALTER COLUMN "amounts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "per_unit_amounts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_prices" ALTER COLUMN "amounts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "amounts" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "add_on_type_prices" DROP COLUMN "value_id";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "per_unit_value_id";--> statement-breakpoint
ALTER TABLE "plan_prices" DROP COLUMN "value_id";--> statement-breakpoint
ALTER TABLE "refunds" DROP COLUMN "value_id";--> statement-breakpoint
DROP TABLE "values";
