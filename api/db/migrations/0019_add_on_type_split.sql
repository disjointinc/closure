-- add_ons -> add_on_types
ALTER TABLE "add_on_features" DROP CONSTRAINT "add_on_features_add_on_id_add_ons_add_on_id_fk";--> statement-breakpoint
ALTER TABLE "add_on_prices" DROP CONSTRAINT "add_on_prices_add_on_id_add_ons_add_on_id_fk";--> statement-breakpoint
ALTER TABLE "assignment_add_ons" DROP CONSTRAINT "assignment_add_ons_add_on_id_add_ons_add_on_id_fk";--> statement-breakpoint
ALTER TABLE "plan_add_ons" DROP CONSTRAINT "plan_add_ons_add_on_id_add_ons_add_on_id_fk";--> statement-breakpoint
ALTER TABLE "add_ons" DROP CONSTRAINT "add_on_id_format";--> statement-breakpoint
ALTER TABLE "add_ons" RENAME TO "add_on_types";--> statement-breakpoint
ALTER TABLE "add_on_types" RENAME COLUMN "add_on_id" TO "add_on_type_id";--> statement-breakpoint
ALTER TABLE "add_on_types" ADD CONSTRAINT "add_on_type_id_format" CHECK ("add_on_types"."add_on_type_id" ~ '^add_on_type_[a-z0-9]{20}$');--> statement-breakpoint

-- add_on_prices -> add_on_type_prices
ALTER TABLE "add_on_prices" DROP CONSTRAINT "add_on_prices_add_on_id_cycle_id_pk";--> statement-breakpoint
ALTER TABLE "add_on_prices" RENAME TO "add_on_type_prices";--> statement-breakpoint
ALTER TABLE "add_on_type_prices" RENAME COLUMN "add_on_id" TO "add_on_type_id";--> statement-breakpoint
ALTER TABLE "add_on_type_prices" ADD CONSTRAINT "add_on_type_prices_add_on_type_id_cycle_id_pk" PRIMARY KEY("add_on_type_id","cycle_id");--> statement-breakpoint

-- add_on_features -> add_on_type_features
ALTER TABLE "add_on_features" DROP CONSTRAINT "add_on_features_add_on_id_feature_id_pk";--> statement-breakpoint
ALTER TABLE "add_on_features" RENAME TO "add_on_type_features";--> statement-breakpoint
ALTER TABLE "add_on_type_features" RENAME COLUMN "add_on_id" TO "add_on_type_id";--> statement-breakpoint
ALTER TABLE "add_on_type_features" ADD CONSTRAINT "add_on_type_features_add_on_type_id_feature_id_pk" PRIMARY KEY("add_on_type_id","feature_id");--> statement-breakpoint

-- plan_add_ons -> plan_add_on_types
ALTER TABLE "plan_add_ons" DROP CONSTRAINT "plan_add_ons_plan_id_add_on_id_pk";--> statement-breakpoint
ALTER TABLE "plan_add_ons" RENAME TO "plan_add_on_types";--> statement-breakpoint
ALTER TABLE "plan_add_on_types" RENAME COLUMN "add_on_id" TO "add_on_type_id";--> statement-breakpoint
ALTER TABLE "plan_add_on_types" ADD CONSTRAINT "plan_add_on_types_plan_id_add_on_type_id_pk" PRIMARY KEY("plan_id","add_on_type_id");--> statement-breakpoint

-- assignment_add_ons: surrogate add_on_id PK, add_on_id -> add_on_type_id
ALTER TABLE "assignment_add_ons" DROP CONSTRAINT "assignment_add_ons_assignment_id_add_on_id_starts_at_pk";--> statement-breakpoint
ALTER TABLE "assignment_add_ons" RENAME COLUMN "add_on_id" TO "add_on_type_id";--> statement-breakpoint
ALTER TABLE "assignment_add_ons" ADD COLUMN "add_on_id" text;--> statement-breakpoint
UPDATE "assignment_add_ons"
SET "add_on_id" = 'add_on_' || (
  SELECT string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', floor(random() * 36)::int + 1, 1), '')
  FROM generate_series(1, 24)
)
WHERE "add_on_id" IS NULL;--> statement-breakpoint
ALTER TABLE "assignment_add_ons" ALTER COLUMN "add_on_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_add_ons" ADD CONSTRAINT "assignment_add_ons_add_on_id_pk" PRIMARY KEY("add_on_id");--> statement-breakpoint
ALTER TABLE "assignment_add_ons" ADD CONSTRAINT "add_on_id_format" CHECK ("assignment_add_ons"."add_on_id" ~ '^add_on_[a-z0-9]{24}$');--> statement-breakpoint

-- re-add foreign keys against the renamed tables/columns
ALTER TABLE "add_on_type_prices" ADD CONSTRAINT "add_on_type_prices_add_on_type_id_add_on_types_add_on_type_id_fk" FOREIGN KEY ("add_on_type_id") REFERENCES "public"."add_on_types"("add_on_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "add_on_type_features" ADD CONSTRAINT "add_on_type_features_add_on_type_id_add_on_types_add_on_type_id_fk" FOREIGN KEY ("add_on_type_id") REFERENCES "public"."add_on_types"("add_on_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_add_on_types" ADD CONSTRAINT "plan_add_on_types_add_on_type_id_add_on_types_add_on_type_id_fk" FOREIGN KEY ("add_on_type_id") REFERENCES "public"."add_on_types"("add_on_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_add_ons" ADD CONSTRAINT "assignment_add_ons_add_on_type_id_add_on_types_add_on_type_id_fk" FOREIGN KEY ("add_on_type_id") REFERENCES "public"."add_on_types"("add_on_type_id") ON DELETE no action ON UPDATE no action;
