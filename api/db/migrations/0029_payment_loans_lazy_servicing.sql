CREATE TABLE "payment_loans" (
	"payment_id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"amount" jsonb NOT NULL,
	"principal_amount" bigint,
	"interest_amount" bigint,
	CONSTRAINT "payment_loans_amount" CHECK (("payment_loans"."amount"->>'value')::numeric between 1 and 9007199254740991),
	CONSTRAINT "payment_loans_allocation" CHECK ((("payment_loans"."principal_amount" is null and "payment_loans"."interest_amount" is null) or ("payment_loans"."principal_amount" between 0 and 9007199254740991 and "payment_loans"."interest_amount" between 0 and 9007199254740991 and "payment_loans"."principal_amount" + "payment_loans"."interest_amount" = ("payment_loans"."amount"->>'value')::numeric)) is true)
);
--> statement-breakpoint
-- Backfill loan repayments recorded on payments by 0028 (none in production).
INSERT INTO "payment_loans" ("payment_id", "loan_id", "amount", "principal_amount", "interest_amount")
SELECT "payment_id", "loan_id", "amount", "loan_principal_amount", "loan_interest_amount"
FROM "payments"
WHERE "loan_id" is not null;
--> statement-breakpoint
ALTER TABLE "loans" DROP CONSTRAINT "loans_servicing_enabled";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_loan_amount";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_loan_allocation";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_loan_id_loans_loan_id_fk";
--> statement-breakpoint
DROP INDEX "loan_installments_period";--> statement-breakpoint
DROP INDEX "loans_servicing_due";--> statement-breakpoint
DROP INDEX "payments_loan";--> statement-breakpoint
DROP INDEX "refunds_idempotency";--> statement-breakpoint
DROP INDEX "loan_installments_open";--> statement-breakpoint
ALTER TABLE "payment_loans" ADD CONSTRAINT "payment_loans_payment_id_payments_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("payment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_loans" ADD CONSTRAINT "payment_loans_loan_id_loans_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("loan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_loans_loan" ON "payment_loans" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "loan_installments_open" ON "loan_installments" USING btree ("loan_id","due_at") WHERE "loan_installments"."canceled_at" is null and "loan_installments"."allocated_amount" < ("loan_installments"."amount"->>'value')::numeric;--> statement-breakpoint
ALTER TABLE "loan_installments" DROP COLUMN "period_key";--> statement-breakpoint
ALTER TABLE "loans" DROP COLUMN "next_service_at";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "loan_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "loan_principal_amount";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "loan_interest_amount";--> statement-breakpoint
ALTER TABLE "refunds" DROP COLUMN "idempotency_key";--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_servicing_enabled" CHECK (("loans"."servicing_terms" is null and "loans"."servicing_state" is null) or ("loans"."servicing_terms" is not null and "loans"."servicing_state" is not null));
