ALTER TABLE "loan_templates" RENAME COLUMN "interest_percentage" TO "annual_interest_percentage";
--> statement-breakpoint
ALTER TABLE "loans" RENAME COLUMN "interest_percentage" TO "annual_interest_percentage";
--> statement-breakpoint
ALTER TABLE "loan_installments" ADD COLUMN "allocated_amount" bigint;
--> statement-breakpoint
ALTER TABLE "loan_installments" ADD COLUMN "canceled_at" bigint;
--> statement-breakpoint
ALTER TABLE "loan_installments" ADD COLUMN "period_key" text;
--> statement-breakpoint
ALTER TABLE "loan_templates" ADD COLUMN "servicing_terms" jsonb;
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "servicing_terms" jsonb;
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "servicing_state" jsonb;
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "next_service_at" bigint;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "loan_id" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount" jsonb;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "loan_principal_amount" bigint;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "loan_interest_amount" bigint;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "payment_id" text;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "loan_principal_amount" bigint;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "loan_interest_amount" bigint;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_loan_id_loans_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("loan_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("payment_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "loan_installments_open" ON "loan_installments" USING btree ("loan_id","due_at") WHERE "loan_installments"."canceled_at" is null and ("loan_installments"."allocated_amount" < ("loan_installments"."amount"->>'value')::numeric or "loan_installments"."period_key" = 'maturity');
--> statement-breakpoint
CREATE UNIQUE INDEX "loan_installments_period" ON "loan_installments" USING btree ("loan_id","period_key") WHERE "loan_installments"."period_key" is not null;
--> statement-breakpoint
CREATE INDEX "loans_servicing_due" ON "loans" USING btree ("next_service_at","loan_id") WHERE "loans"."deleted_at" is null and "loans"."closed_at" is null and "loans"."servicing_state" is not null;
--> statement-breakpoint
CREATE INDEX "payments_loan" ON "payments" USING btree ("loan_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider" ON "payments" USING btree ("tenant_id",("provider_internals"->>'provider'),("provider_internals"->>'paymentId'));
--> statement-breakpoint
CREATE INDEX "refunds_payment" ON "refunds" USING btree ("payment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency" ON "refunds" USING btree ("tenant_id","idempotency_key") WHERE "refunds"."idempotency_key" is not null;
--> statement-breakpoint
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_allocation" CHECK ("loan_installments"."allocated_amount" is null or ("loan_installments"."allocated_amount" >= 0 and "loan_installments"."allocated_amount" <= ("loan_installments"."amount"->>'value')::numeric));
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_servicing_enabled" CHECK (("loans"."servicing_terms" is null and "loans"."servicing_state" is null and "loans"."next_service_at" is null) or ("loans"."servicing_terms" is not null and "loans"."servicing_state" is not null));
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_loan_amount" CHECK ("payments"."loan_id" is null or ("payments"."amount" is not null and ("payments"."amount"->>'value')::numeric between 1 and 9007199254740991));
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_loan_allocation" CHECK ((("payments"."loan_principal_amount" is null and "payments"."loan_interest_amount" is null and ("payments"."loan_id" is null or "payments"."succeeded_at" is null)) or ("payments"."loan_id" is not null and "payments"."succeeded_at" is not null and "payments"."failed_at" is null and "payments"."loan_principal_amount" between 0 and 9007199254740991 and "payments"."loan_interest_amount" between 0 and 9007199254740991 and "payments"."loan_principal_amount" + "payments"."loan_interest_amount" = ("payments"."amount"->>'value')::numeric)) is true);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_loan_allocation" CHECK ((("refunds"."loan_principal_amount" is null and "refunds"."loan_interest_amount" is null) or ("refunds"."payment_id" is not null and "refunds"."succeeded_at" is not null and "refunds"."failed_at" is null and "refunds"."loan_principal_amount" between 0 and 9007199254740991 and "refunds"."loan_interest_amount" between 0 and 9007199254740991 and "refunds"."loan_principal_amount" + "refunds"."loan_interest_amount" > 0)) is true);
