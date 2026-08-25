CREATE TABLE "coupon_template_credits_granted" (
	"coupon_template" text NOT NULL,
	"meter" text NOT NULL,
	"amount_microcredits" bigint NOT NULL,
	"expiration" jsonb,
	"rollovers" integer,
	"award" jsonb NOT NULL,
	CONSTRAINT "coupon_template_credits_granted_coupon_template_meter_pk" PRIMARY KEY("coupon_template","meter"),
	CONSTRAINT "coupon_template_credits_amount_positive" CHECK (amount_microcredits > 0)
);
--> statement-breakpoint
CREATE TABLE "coupon_template_features_granted" (
	"coupon_template" text NOT NULL,
	"feature" text NOT NULL,
	"value" jsonb NOT NULL,
	"award" jsonb NOT NULL,
	CONSTRAINT "coupon_template_features_granted_coupon_template_feature_pk" PRIMARY KEY("coupon_template","feature")
);
--> statement-breakpoint
CREATE TABLE "coupon_templates" (
	"unique_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"grantable_by_tenants" boolean NOT NULL,
	"limit_per_granting_tenant" integer,
	"name" text NOT NULL,
	"description" text,
	"default_award" jsonb,
	"reciprocal_benefit_coupon_template" text,
	CONSTRAINT "coupon_template_id_format" CHECK ("coupon_templates"."unique_id" ~ '^coupon_template_[a-z0-9]{20}$'),
	CONSTRAINT "coupon_templates_grantable_gating" CHECK (grantable_by_tenants or (limit_per_granting_tenant is null and reciprocal_benefit_coupon_template is null))
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "template" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "deleted_at" bigint;--> statement-breakpoint
ALTER TABLE "coupon_template_credits_granted" ADD CONSTRAINT "coupon_template_credits_granted_coupon_template_coupon_templates_unique_id_fk" FOREIGN KEY ("coupon_template") REFERENCES "public"."coupon_templates"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_template_credits_granted" ADD CONSTRAINT "coupon_template_credits_granted_meter_meters_unique_id_fk" FOREIGN KEY ("meter") REFERENCES "public"."meters"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_template_features_granted" ADD CONSTRAINT "coupon_template_features_granted_coupon_template_coupon_templates_unique_id_fk" FOREIGN KEY ("coupon_template") REFERENCES "public"."coupon_templates"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_template_features_granted" ADD CONSTRAINT "coupon_template_features_granted_feature_features_unique_id_fk" FOREIGN KEY ("feature") REFERENCES "public"."features"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_templates" ADD CONSTRAINT "coupon_templates_reciprocal_benefit_coupon_template_coupon_templates_unique_id_fk" FOREIGN KEY ("reciprocal_benefit_coupon_template") REFERENCES "public"."coupon_templates"("unique_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_template_coupon_templates_unique_id_fk" FOREIGN KEY ("template") REFERENCES "public"."coupon_templates"("unique_id") ON DELETE no action ON UPDATE no action;