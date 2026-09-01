CREATE TABLE "loans" (
	"loan_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"closed_at" bigint,
	"principal" jsonb NOT NULL,
	CONSTRAINT "loan_id_format" CHECK ("loans"."loan_id" ~ '^loan_[a-z0-9]{24}$')
);
--> statement-breakpoint
ALTER TABLE "plan_prices" ALTER COLUMN "value_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD COLUMN "interest_percentage" double precision;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD COLUMN "minimum_payment_value_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "duration" jsonb;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loans_tenant" ON "loans" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_minimum_payment_value_id_values_value_id_fk" FOREIGN KEY ("minimum_payment_value_id") REFERENCES "public"."values"("value_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_variant" CHECK ((value_id is not null and interest_percentage is null and minimum_payment_value_id is null)
       or (value_id is null and interest_percentage is not null and minimum_payment_value_id is not null));