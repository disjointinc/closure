ALTER TABLE "plans" DROP CONSTRAINT "plans_kind_variant";--> statement-breakpoint
ALTER TABLE "loan_templates" ADD COLUMN "duration" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "ends_at" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "duration" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "duration";--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_kind_variant" CHECK ((kind = 'standard' and default_interest_percentage is null and minimum_payment_value_id is null)
       or (kind = 'loan' and minimum_payment_value_id is not null));