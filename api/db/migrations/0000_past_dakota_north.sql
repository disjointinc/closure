CREATE TYPE "public"."charged" AS ENUM('upfront', 'arrears');--> statement-breakpoint
CREATE TYPE "public"."grantor_type" AS ENUM('team_member', 'tenant', 'reciprocal');--> statement-breakpoint
CREATE TYPE "public"."meter_event_status" AS ENUM('succeeded', 'insufficient_balance', 'unexpected_error');--> statement-breakpoint
CREATE TABLE "add_on_features" (
	"add_on" text NOT NULL,
	"feature" text NOT NULL,
	"set_to" jsonb NOT NULL,
	CONSTRAINT "add_on_features_add_on_feature_pk" PRIMARY KEY("add_on","feature")
);
--> statement-breakpoint
CREATE TABLE "add_on_prices" (
	"add_on" text NOT NULL,
	"cycle" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "add_on_prices_add_on_cycle_pk" PRIMARY KEY("add_on","cycle")
);
--> statement-breakpoint
CREATE TABLE "add_ons" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "add_on_id_format" CHECK ("add_ons"."unique_id" ~ '^add_on_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "assignment_add_ons" (
	"assignment" text NOT NULL,
	"add_on" text NOT NULL,
	"start" bigint NOT NULL,
	"end" bigint,
	CONSTRAINT "assignment_add_ons_assignment_add_on_start_pk" PRIMARY KEY("assignment","add_on","start")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"plan" text NOT NULL,
	"experiment" text,
	"cycle" text NOT NULL,
	"start" bigint NOT NULL,
	"end" bigint,
	CONSTRAINT "assignment_id_format" CHECK ("assignments"."unique_id" ~ '^assignment_[a-z0-9]{24}$')
);
--> statement-breakpoint
CREATE TABLE "coupon_credits_granted" (
	"coupon" text NOT NULL,
	"meter" text NOT NULL,
	"amount_microcredits" bigint NOT NULL,
	"expiration" jsonb,
	"rollovers" integer,
	"award" jsonb NOT NULL,
	CONSTRAINT "coupon_credits_granted_coupon_meter_pk" PRIMARY KEY("coupon","meter"),
	CONSTRAINT "coupon_credits_amount_positive" CHECK (amount_microcredits > 0)
);
--> statement-breakpoint
CREATE TABLE "coupon_features_granted" (
	"coupon" text NOT NULL,
	"feature" text NOT NULL,
	"value" jsonb NOT NULL,
	"award" jsonb NOT NULL,
	CONSTRAINT "coupon_features_granted_coupon_feature_pk" PRIMARY KEY("coupon","feature")
);
--> statement-breakpoint
CREATE TABLE "coupon_grants" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"coupon" text NOT NULL,
	"on" bigint NOT NULL,
	"to_tenant" text NOT NULL,
	"used_at" bigint,
	"reason" text,
	CONSTRAINT "coupon_grant_id_format" CHECK ("coupon_grants"."unique_id" ~ '^coupon_grant_[a-z0-9]{27}$')
);
--> statement-breakpoint
CREATE TABLE "coupon_receipts" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"coupon" text NOT NULL,
	"on" bigint NOT NULL,
	"used_at" bigint,
	"reason" text,
	"grantor_type" "grantor_type" NOT NULL,
	"by_team_member" text,
	"by_tenant" text,
	"by_coupon_grant" text,
	CONSTRAINT "coupon_receipt_id_format" CHECK ("coupon_receipts"."unique_id" ~ '^coupon_receipt_[a-z0-9]{27}$'),
	CONSTRAINT "coupon_receipts_grantor_variant" CHECK ((grantor_type = 'team_member' and by_team_member is not null and by_tenant is null and by_coupon_grant is null)
       or (grantor_type = 'tenant' and by_team_member is null and by_tenant is not null and by_coupon_grant is null)
       or (grantor_type = 'reciprocal' and by_team_member is null and by_tenant is null and by_coupon_grant is not null))
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"grantable_by_tenants" boolean NOT NULL,
	"limit_per_granting_tenant" integer,
	"name" text NOT NULL,
	"description" text,
	"default_award" jsonb,
	"reciprocal_benefit_coupon" text,
	CONSTRAINT "coupon_id_format" CHECK ("coupons"."unique_id" ~ '^coupon_[a-z0-9]{20}$'),
	CONSTRAINT "coupons_grantable_gating" CHECK (grantable_by_tenants or (limit_per_granting_tenant is null and reciprocal_benefit_coupon is null))
);
--> statement-breakpoint
CREATE TABLE "credit_grants" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"meter" text NOT NULL,
	"on" bigint NOT NULL,
	"by_team_member" text NOT NULL,
	"reason" text,
	"amount_microcredits" bigint NOT NULL,
	CONSTRAINT "credit_grant_id_format" CHECK ("credit_grants"."unique_id" ~ '^credit_grant_[a-z0-9]{25}$'),
	CONSTRAINT "credit_grants_amount_positive" CHECK (amount_microcredits > 0)
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	"charged" charged NOT NULL,
	"cycle_length" jsonb NOT NULL,
	"credit_period" jsonb,
	"grace_period" jsonb,
	"dunning_schedule" jsonb,
	CONSTRAINT "cycle_id_format" CHECK ("cycles"."unique_id" ~ '^cycle_[a-z0-9]{20}$'),
	CONSTRAINT "cycles_charging_variant" CHECK ((charged = 'upfront' and credit_period is null and grace_period is null and dunning_schedule is null)
     or (charged = 'arrears' and credit_period is not null))
);
--> statement-breakpoint
CREATE TABLE "experiment_treatment_tenants" (
	"experiment" text NOT NULL,
	"plan" text NOT NULL,
	"tenant" text NOT NULL,
	CONSTRAINT "experiment_treatment_tenants_experiment_tenant_pk" PRIMARY KEY("experiment","tenant")
);
--> statement-breakpoint
CREATE TABLE "experiment_treatments" (
	"experiment" text NOT NULL,
	"plan" text NOT NULL,
	"tenant_percentage" double precision NOT NULL,
	CONSTRAINT "experiment_treatments_experiment_plan_pk" PRIMARY KEY("experiment","plan"),
	CONSTRAINT "experiment_treatments_percentage_range" CHECK (tenant_percentage >= 0 and tenant_percentage <= 100)
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"concluded_at" bigint,
	"plan_assignment_at_conclusion" text,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "experiment_id_format" CHECK ("experiments"."unique_id" ~ '^experiment_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "feature_options" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"feature" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "feature_option_id_format" CHECK ("feature_options"."unique_id" ~ '^feature_option_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "feature_overrides" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"feature" text NOT NULL,
	"set_to" jsonb NOT NULL,
	"on" bigint NOT NULL,
	"by_team_member" text NOT NULL,
	"reason" text,
	CONSTRAINT "feature_override_id_format" CHECK ("feature_overrides"."unique_id" ~ '^feature_override_[a-z0-9]{24}$')
);
--> statement-breakpoint
CREATE TABLE "feature_tax_types" (
	"feature" text NOT NULL,
	"tax_type" text NOT NULL,
	CONSTRAINT "feature_tax_types_feature_tax_type_pk" PRIMARY KEY("feature","tax_type")
);
--> statement-breakpoint
CREATE TABLE "features" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "feature_id_format" CHECK ("features"."unique_id" ~ '^feature_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"created_at" bigint NOT NULL,
	"closed_at" bigint,
	"closed_reason" text,
	"charged" charged NOT NULL,
	"cycle_length" jsonb NOT NULL,
	"credit_period" jsonb,
	"grace_period" jsonb,
	"dunning_schedule" jsonb,
	CONSTRAINT "invoice_id_format" CHECK ("invoices"."unique_id" ~ '^invoice_[a-z0-9]{25}$'),
	CONSTRAINT "invoices_charging_variant" CHECK ((charged = 'upfront' and credit_period is null and grace_period is null and dunning_schedule is null)
     or (charged = 'arrears' and credit_period is not null))
);
--> statement-breakpoint
CREATE TABLE "items" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"invoice" text NOT NULL,
	"per_unit_value" text NOT NULL,
	"units" double precision NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "item_id_format" CHECK ("items"."unique_id" ~ '^item_[a-z0-9]{27}$'),
	CONSTRAINT "items_units_nonnegative" CHECK (units >= 0)
);
--> statement-breakpoint
CREATE TABLE "meter_balances" (
	"tenant" text NOT NULL,
	"meter" text NOT NULL,
	"balance_microcredits" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "meter_balances_tenant_meter_pk" PRIMARY KEY("tenant","meter"),
	CONSTRAINT "meter_balances_nonnegative" CHECK (balance_microcredits >= 0)
);
--> statement-breakpoint
CREATE TABLE "meter_events" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"ideally_unique_external_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"meter" text NOT NULL,
	"tenant" text NOT NULL,
	"amount_microcredits" bigint NOT NULL,
	"status" "meter_event_status" NOT NULL,
	CONSTRAINT "meter_event_id_format" CHECK ("meter_events"."unique_id" ~ '^meter_event_[a-z0-9]{37}$'),
	CONSTRAINT "meter_events_amount_positive" CHECK (amount_microcredits > 0)
);
--> statement-breakpoint
CREATE TABLE "meter_overrides" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"meter" text NOT NULL,
	"default_microcredits" bigint NOT NULL,
	"limit_microcredits" bigint,
	"reset" jsonb,
	"rollovers" integer,
	"top_up_prices_per_credit" jsonb,
	"top_up_credit_pack_sizes" jsonb,
	"on" bigint NOT NULL,
	"by_team_member" text NOT NULL,
	"reason" text,
	CONSTRAINT "meter_override_id_format" CHECK ("meter_overrides"."unique_id" ~ '^meter_override_[a-z0-9]{24}$'),
	CONSTRAINT "meter_overrides_limit_gte_default" CHECK (limit_microcredits is null or limit_microcredits >= default_microcredits),
	CONSTRAINT "meter_overrides_default_nonnegative" CHECK (default_microcredits >= 0),
	CONSTRAINT "meter_overrides_limit_positive" CHECK (limit_microcredits > 0)
);
--> statement-breakpoint
CREATE TABLE "meter_tax_types" (
	"meter" text NOT NULL,
	"tax_type" text NOT NULL,
	CONSTRAINT "meter_tax_types_meter_tax_type_pk" PRIMARY KEY("meter","tax_type")
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "meter_id_format" CHECK ("meters"."unique_id" ~ '^meter_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "payment_invoices" (
	"payment" text NOT NULL,
	"invoice" text NOT NULL,
	CONSTRAINT "payment_invoices_payment_invoice_pk" PRIMARY KEY("payment","invoice")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"is_default" boolean NOT NULL,
	"provider_internals" jsonb NOT NULL,
	CONSTRAINT "payment_method_id_format" CHECK ("payment_methods"."unique_id" ~ '^payment_method_[a-z0-9]{23}$')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"created_at" bigint NOT NULL,
	"started_processing_at" bigint,
	"succeeded_at" bigint,
	"failed_at" bigint,
	"provider_internals" jsonb NOT NULL,
	CONSTRAINT "payment_id_format" CHECK ("payments"."unique_id" ~ '^payment_[a-z0-9]{25}$')
);
--> statement-breakpoint
CREATE TABLE "plan_add_ons" (
	"plan" text NOT NULL,
	"add_on" text NOT NULL,
	CONSTRAINT "plan_add_ons_plan_add_on_pk" PRIMARY KEY("plan","add_on")
);
--> statement-breakpoint
CREATE TABLE "plan_features" (
	"plan" text NOT NULL,
	"feature" text NOT NULL,
	"set_to" jsonb NOT NULL,
	CONSTRAINT "plan_features_plan_feature_pk" PRIMARY KEY("plan","feature")
);
--> statement-breakpoint
CREATE TABLE "plan_meters" (
	"plan" text NOT NULL,
	"meter" text NOT NULL,
	"default_microcredits" bigint NOT NULL,
	"limit_microcredits" bigint,
	"reset" jsonb,
	"rollovers" integer,
	"top_up_prices_per_credit" jsonb,
	"top_up_credit_pack_sizes" jsonb,
	CONSTRAINT "plan_meters_plan_meter_pk" PRIMARY KEY("plan","meter"),
	CONSTRAINT "plan_meters_limit_gte_default" CHECK (limit_microcredits is null or limit_microcredits >= default_microcredits),
	CONSTRAINT "plan_meters_default_nonnegative" CHECK (default_microcredits >= 0),
	CONSTRAINT "plan_meters_limit_positive" CHECK (limit_microcredits > 0)
);
--> statement-breakpoint
CREATE TABLE "plan_prices" (
	"plan" text NOT NULL,
	"cycle" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "plan_prices_plan_cycle_pk" PRIMARY KEY("plan","cycle")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"derived_from" text,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "plan_id_format" CHECK ("plans"."unique_id" ~ '^plan_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"tenant" text NOT NULL,
	"created_at" bigint NOT NULL,
	"started_processing_at" bigint,
	"succeeded_at" bigint,
	"failed_at" bigint,
	"by_team_member" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	CONSTRAINT "refund_id_format" CHECK ("refunds"."unique_id" ~ '^refund_[a-z0-9]{23}$')
);
--> statement-breakpoint
CREATE TABLE "tax_types" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "tax_type_id_format" CHECK ("tax_types"."unique_id" ~ '^tax_type_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "taxation_amount_items" (
	"taxation_amount" text NOT NULL,
	"item" text NOT NULL,
	CONSTRAINT "taxation_amount_items_taxation_amount_item_pk" PRIMARY KEY("taxation_amount","item")
);
--> statement-breakpoint
CREATE TABLE "taxation_amounts" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"invoice" text NOT NULL,
	"tax" text NOT NULL,
	"notes" text,
	"amount" jsonb NOT NULL,
	CONSTRAINT "taxation_amount_id_format" CHECK ("taxation_amounts"."unique_id" ~ '^taxation_amount_[a-z0-9]{27}$')
);
--> statement-breakpoint
CREATE TABLE "taxes" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"tax_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "tax_id_format" CHECK ("taxes"."unique_id" ~ '^tax_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"email_address" text NOT NULL,
	"name" text,
	"profile_picture_link" text,
	CONSTRAINT "team_members_email_address_unique" UNIQUE("email_address"),
	CONSTRAINT "team_member_id_format" CHECK ("team_members"."unique_id" ~ '^team_member_[a-z0-9]{16}$')
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"external_ids" jsonb NOT NULL,
	CONSTRAINT "tenant_id_format" CHECK ("tenants"."unique_id" ~ '^tenant_[a-z0-9]{22}$')
);
--> statement-breakpoint
CREATE TABLE "values" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	"amounts" jsonb NOT NULL,
	CONSTRAINT "value_id_format" CHECK ("values"."unique_id" ~ '^value_[a-z0-9]{20}$')
);
--> statement-breakpoint
ALTER TABLE "add_on_features" ADD CONSTRAINT "add_on_features_add_on_add_ons_unique_id_fk" FOREIGN KEY ("add_on") REFERENCES "public"."add_ons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_features" ADD CONSTRAINT "add_on_features_feature_features_unique_id_fk" FOREIGN KEY ("feature") REFERENCES "public"."features"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_add_on_add_ons_unique_id_fk" FOREIGN KEY ("add_on") REFERENCES "public"."add_ons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_cycle_cycles_unique_id_fk" FOREIGN KEY ("cycle") REFERENCES "public"."cycles"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_prices" ADD CONSTRAINT "add_on_prices_value_values_unique_id_fk" FOREIGN KEY ("value") REFERENCES "public"."values"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_add_ons" ADD CONSTRAINT "assignment_add_ons_assignment_assignments_unique_id_fk" FOREIGN KEY ("assignment") REFERENCES "public"."assignments"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_add_ons" ADD CONSTRAINT "assignment_add_ons_add_on_add_ons_unique_id_fk" FOREIGN KEY ("add_on") REFERENCES "public"."add_ons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_plan_plans_unique_id_fk" FOREIGN KEY ("plan") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_experiment_experiments_unique_id_fk" FOREIGN KEY ("experiment") REFERENCES "public"."experiments"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cycle_cycles_unique_id_fk" FOREIGN KEY ("cycle") REFERENCES "public"."cycles"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_credits_granted" ADD CONSTRAINT "coupon_credits_granted_coupon_coupons_unique_id_fk" FOREIGN KEY ("coupon") REFERENCES "public"."coupons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_credits_granted" ADD CONSTRAINT "coupon_credits_granted_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_features_granted" ADD CONSTRAINT "coupon_features_granted_coupon_coupons_unique_id_fk" FOREIGN KEY ("coupon") REFERENCES "public"."coupons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_features_granted" ADD CONSTRAINT "coupon_features_granted_feature_features_unique_id_fk" FOREIGN KEY ("feature") REFERENCES "public"."features"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_grants" ADD CONSTRAINT "coupon_grants_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_grants" ADD CONSTRAINT "coupon_grants_coupon_coupons_unique_id_fk" FOREIGN KEY ("coupon") REFERENCES "public"."coupons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_grants" ADD CONSTRAINT "coupon_grants_to_tenant_tenants_unique_id_fk" FOREIGN KEY ("to_tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_receipts" ADD CONSTRAINT "coupon_receipts_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_receipts" ADD CONSTRAINT "coupon_receipts_coupon_coupons_unique_id_fk" FOREIGN KEY ("coupon") REFERENCES "public"."coupons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_receipts" ADD CONSTRAINT "coupon_receipts_by_team_member_team_members_unique_id_fk" FOREIGN KEY ("by_team_member") REFERENCES "public"."team_members"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_receipts" ADD CONSTRAINT "coupon_receipts_by_tenant_tenants_unique_id_fk" FOREIGN KEY ("by_tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_receipts" ADD CONSTRAINT "coupon_receipts_by_coupon_grant_coupon_grants_unique_id_fk" FOREIGN KEY ("by_coupon_grant") REFERENCES "public"."coupon_grants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_reciprocal_benefit_coupon_coupons_unique_id_fk" FOREIGN KEY ("reciprocal_benefit_coupon") REFERENCES "public"."coupons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_by_team_member_team_members_unique_id_fk" FOREIGN KEY ("by_team_member") REFERENCES "public"."team_members"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_treatment_tenants" ADD CONSTRAINT "experiment_treatment_tenants_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_treatment_tenants" ADD CONSTRAINT "experiment_treatment_tenants_experiment_plan_experiment_treatments_experiment_plan_fk" FOREIGN KEY ("experiment","plan") REFERENCES "public"."experiment_treatments"("experiment","plan") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD CONSTRAINT "experiment_treatments_experiment_experiments_unique_id_fk" FOREIGN KEY ("experiment") REFERENCES "public"."experiments"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD CONSTRAINT "experiment_treatments_plan_plans_unique_id_fk" FOREIGN KEY ("plan") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_plan_assignment_at_conclusion_plans_unique_id_fk" FOREIGN KEY ("plan_assignment_at_conclusion") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_options" ADD CONSTRAINT "feature_options_feature_features_unique_id_fk" FOREIGN KEY ("feature") REFERENCES "public"."features"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_feature_features_unique_id_fk" FOREIGN KEY ("feature") REFERENCES "public"."features"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_by_team_member_team_members_unique_id_fk" FOREIGN KEY ("by_team_member") REFERENCES "public"."team_members"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_tax_types" ADD CONSTRAINT "feature_tax_types_feature_features_unique_id_fk" FOREIGN KEY ("feature") REFERENCES "public"."features"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_tax_types" ADD CONSTRAINT "feature_tax_types_tax_type_tax_types_unique_id_fk" FOREIGN KEY ("tax_type") REFERENCES "public"."tax_types"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_invoice_invoices_unique_id_fk" FOREIGN KEY ("invoice") REFERENCES "public"."invoices"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_per_unit_value_values_unique_id_fk" FOREIGN KEY ("per_unit_value") REFERENCES "public"."values"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_balances" ADD CONSTRAINT "meter_balances_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_balances" ADD CONSTRAINT "meter_balances_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_events" ADD CONSTRAINT "meter_events_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_events" ADD CONSTRAINT "meter_events_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_overrides" ADD CONSTRAINT "meter_overrides_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_overrides" ADD CONSTRAINT "meter_overrides_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_overrides" ADD CONSTRAINT "meter_overrides_by_team_member_team_members_unique_id_fk" FOREIGN KEY ("by_team_member") REFERENCES "public"."team_members"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_tax_types" ADD CONSTRAINT "meter_tax_types_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_tax_types" ADD CONSTRAINT "meter_tax_types_tax_type_tax_types_unique_id_fk" FOREIGN KEY ("tax_type") REFERENCES "public"."tax_types"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_payment_payments_unique_id_fk" FOREIGN KEY ("payment") REFERENCES "public"."payments"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_invoice_invoices_unique_id_fk" FOREIGN KEY ("invoice") REFERENCES "public"."invoices"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_add_ons" ADD CONSTRAINT "plan_add_ons_plan_plans_unique_id_fk" FOREIGN KEY ("plan") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_add_ons" ADD CONSTRAINT "plan_add_ons_add_on_add_ons_unique_id_fk" FOREIGN KEY ("add_on") REFERENCES "public"."add_ons"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_plans_unique_id_fk" FOREIGN KEY ("plan") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_feature_features_unique_id_fk" FOREIGN KEY ("feature") REFERENCES "public"."features"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meters" ADD CONSTRAINT "plan_meters_plan_plans_unique_id_fk" FOREIGN KEY ("plan") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meters" ADD CONSTRAINT "plan_meters_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_plans_unique_id_fk" FOREIGN KEY ("plan") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_cycle_cycles_unique_id_fk" FOREIGN KEY ("cycle") REFERENCES "public"."cycles"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_value_values_unique_id_fk" FOREIGN KEY ("value") REFERENCES "public"."values"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_derived_from_plans_unique_id_fk" FOREIGN KEY ("derived_from") REFERENCES "public"."plans"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_tenants_unique_id_fk" FOREIGN KEY ("tenant") REFERENCES "public"."tenants"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_by_team_member_team_members_unique_id_fk" FOREIGN KEY ("by_team_member") REFERENCES "public"."team_members"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_value_values_unique_id_fk" FOREIGN KEY ("value") REFERENCES "public"."values"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxation_amount_items" ADD CONSTRAINT "taxation_amount_items_taxation_amount_taxation_amounts_unique_id_fk" FOREIGN KEY ("taxation_amount") REFERENCES "public"."taxation_amounts"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxation_amount_items" ADD CONSTRAINT "taxation_amount_items_item_items_unique_id_fk" FOREIGN KEY ("item") REFERENCES "public"."items"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxation_amounts" ADD CONSTRAINT "taxation_amounts_invoice_invoices_unique_id_fk" FOREIGN KEY ("invoice") REFERENCES "public"."invoices"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxation_amounts" ADD CONSTRAINT "taxation_amounts_tax_taxes_unique_id_fk" FOREIGN KEY ("tax") REFERENCES "public"."taxes"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_tax_type_tax_types_unique_id_fk" FOREIGN KEY ("tax_type") REFERENCES "public"."tax_types"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_tenant" ON "assignments" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "experiment_treatment_tenants_tenant" ON "experiment_treatment_tenants" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "invoices_tenant" ON "invoices" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "meter_events_idempotency" ON "meter_events" USING btree ("tenant","meter","ideally_unique_external_id");--> statement-breakpoint
CREATE INDEX "meter_events_tenant_meter_created" ON "meter_events" USING btree ("tenant","meter","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_one_default" ON "payment_methods" USING btree ("tenant") WHERE "payment_methods"."is_default" and "payment_methods"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "payments_tenant" ON "payments" USING btree ("tenant");