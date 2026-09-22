UPDATE "experiments" SET "concluding_plans" = '[]' WHERE "concluding_plans" IS NULL;--> statement-breakpoint
UPDATE "meter_overrides" SET "top_up_prices_per_credit" = '[]' WHERE "top_up_prices_per_credit" IS NULL;--> statement-breakpoint
UPDATE "plan_meters" SET "top_up_prices_per_credit" = '[]' WHERE "top_up_prices_per_credit" IS NULL;--> statement-breakpoint
UPDATE "task_types" SET "integrations" = '[]' WHERE "integrations" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "external_refs" = '[]' WHERE "external_refs" IS NULL;--> statement-breakpoint
ALTER TABLE "experiments" ALTER COLUMN "concluding_plans" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meter_overrides" ALTER COLUMN "top_up_prices_per_credit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_meters" ALTER COLUMN "top_up_prices_per_credit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_types" ALTER COLUMN "integrations" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "external_refs" SET NOT NULL;
