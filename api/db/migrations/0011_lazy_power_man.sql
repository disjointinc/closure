CREATE TYPE "public"."plan_kind" AS ENUM('standard', 'loan');--> statement-breakpoint
ALTER TABLE "plan_prices" DROP CONSTRAINT "plan_prices_variant";--> statement-breakpoint
ALTER TABLE "plan_prices" DROP CONSTRAINT "plan_prices_minimum_payment_value_id_values_value_id_fk";
--> statement-breakpoint
ALTER TABLE "plan_prices" ALTER COLUMN "value_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "interest_percentage" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "kind" "plan_kind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "default_interest_percentage" double precision;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "minimum_payment_value_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_minimum_payment_value_id_values_value_id_fk" FOREIGN KEY ("minimum_payment_value_id") REFERENCES "public"."values"("value_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" DROP COLUMN "interest_percentage";--> statement-breakpoint
ALTER TABLE "plan_prices" DROP COLUMN "minimum_payment_value_id";--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_kind_variant" CHECK ((kind = 'standard' and duration is null and default_interest_percentage is null and minimum_payment_value_id is null)
       or (kind = 'loan' and duration is not null and minimum_payment_value_id is not null));