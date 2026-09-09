CREATE TABLE "loan_installments" (
	"installment_id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"due_at" bigint NOT NULL,
	"amount" jsonb NOT NULL,
	"paid_at" bigint,
	CONSTRAINT "installment_id_format" CHECK ("loan_installments"."installment_id" ~ '^installment_[a-z0-9]{25}$')
);
--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT "plans_kind_variant";--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT "plans_minimum_payment_value_id_values_value_id_fk";
--> statement-breakpoint
DROP INDEX "assignments_one_open";--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "deleted_at" bigint;--> statement-breakpoint
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_id_loans_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("loan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_installments_loan" ON "loan_installments" USING btree ("loan_id");--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "default_interest_percentage";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "minimum_payment_value_id";--> statement-breakpoint
DROP TYPE "public"."plan_kind";