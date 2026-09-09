-- Treatments become plan-sets (at most one plan per product line);
-- conclusions name one plan per touched line. Pre-plan-set experiment
-- data doesn't map, so it's dropped.
TRUNCATE experiment_treatment_tenants, experiment_treatments, experiments CASCADE;
--> statement-breakpoint
CREATE TABLE "experiment_treatment_plans" (
	"experiment_id" text NOT NULL,
	"treatment_id" text NOT NULL,
	"plan_id" text NOT NULL,
	CONSTRAINT "experiment_treatment_plans_experiment_id_treatment_id_plan_id_pk" PRIMARY KEY("experiment_id","treatment_id","plan_id")
);
--> statement-breakpoint
ALTER TABLE "experiments" DROP CONSTRAINT "experiments_concluding_plan_id_plans_plan_id_fk";--> statement-breakpoint
ALTER TABLE "experiment_treatments" DROP CONSTRAINT "experiment_treatments_plan_id_plans_plan_id_fk";--> statement-breakpoint
ALTER TABLE "experiment_treatment_tenants" DROP CONSTRAINT "experiment_treatment_tenants_experiment_id_plan_id_experiment_treatments_experiment_id_plan_id_fk";--> statement-breakpoint
ALTER TABLE "experiments" DROP COLUMN "concluding_plan_id";--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "concluding_plans" jsonb;--> statement-breakpoint
ALTER TABLE "experiment_treatments" DROP CONSTRAINT "experiment_treatments_experiment_id_plan_id_pk";--> statement-breakpoint
ALTER TABLE "experiment_treatments" DROP COLUMN "plan_id";--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD COLUMN "treatment_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD CONSTRAINT "experiment_treatments_experiment_id_treatment_id_pk" PRIMARY KEY("experiment_id","treatment_id");--> statement-breakpoint
ALTER TABLE "experiment_treatments" ADD CONSTRAINT "treatment_id_format" CHECK ("experiment_treatments"."treatment_id" ~ '^treatment_[a-z0-9]{20}$');--> statement-breakpoint
ALTER TABLE "experiment_treatment_tenants" DROP COLUMN "plan_id";--> statement-breakpoint
ALTER TABLE "experiment_treatment_tenants" ADD COLUMN "treatment_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_treatment_tenants" ADD CONSTRAINT "experiment_treatment_tenants_experiment_id_treatment_id_experiment_treatmen_fk" FOREIGN KEY ("experiment_id","treatment_id") REFERENCES "public"."experiment_treatments"("experiment_id","treatment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_treatment_plans" ADD CONSTRAINT "experiment_treatment_plans_plan_id_plans_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_treatment_plans" ADD CONSTRAINT "experiment_treatment_plans_experiment_id_treatment_id_experiment_treatmen_fk" FOREIGN KEY ("experiment_id","treatment_id") REFERENCES "public"."experiment_treatments"("experiment_id","treatment_id") ON DELETE no action ON UPDATE no action;
