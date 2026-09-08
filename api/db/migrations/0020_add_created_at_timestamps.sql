ALTER TABLE "assignment_add_ons" ADD COLUMN "created_at" bigint;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "created_at" bigint;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "created_at" bigint;--> statement-breakpoint

-- Backfill existing rows: use the row's own timestamp where one exists,
-- otherwise now.
UPDATE "assignment_add_ons" SET "created_at" = "starts_at" WHERE "created_at" IS NULL;--> statement-breakpoint
UPDATE "assignments" SET "created_at" = "starts_at" WHERE "created_at" IS NULL;--> statement-breakpoint
UPDATE "team_members" SET "created_at" = (extract(epoch from now()) * 1000)::bigint WHERE "created_at" IS NULL;--> statement-breakpoint

ALTER TABLE "assignment_add_ons" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "created_at" SET NOT NULL;
