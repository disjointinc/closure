UPDATE "meter_overrides" SET "top_up_credit_pack_sizes" = '{"static":null,"dynamic":null}' WHERE "top_up_credit_pack_sizes" IS NULL;--> statement-breakpoint
UPDATE "plan_meters" SET "top_up_credit_pack_sizes" = '{"static":null,"dynamic":null}' WHERE "top_up_credit_pack_sizes" IS NULL;--> statement-breakpoint
ALTER TABLE "meter_overrides" ALTER COLUMN "top_up_credit_pack_sizes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_meters" ALTER COLUMN "top_up_credit_pack_sizes" SET NOT NULL;
