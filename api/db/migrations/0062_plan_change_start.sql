-- A plan change records whether the assignment it supersedes is credited
-- for unused time, and Closure does each assignment's start work (meter
-- changes, credits) when it starts. Existing assignments credit unused
-- time, the default, and their start work was done when they were created.
CREATE TYPE "public"."superseded_credit" AS ENUM('unused_time', 'none');--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "superseded_credit" "superseded_credit";--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "start_handled_at" bigint;--> statement-breakpoint
UPDATE "assignments" SET "superseded_credit" = 'unused_time', "start_handled_at" = "created_at";--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "superseded_credit" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "assignments_start_unhandled" ON "assignments" USING btree ("starts_at") WHERE "assignments"."start_handled_at" is null;--> statement-breakpoint
-- A plan change moves meter balances by credit grants of its own, which
-- can take credits back.
ALTER TABLE "credit_grants" DROP CONSTRAINT "credit_grants_amount_positive";--> statement-breakpoint
ALTER TABLE "credit_grants" ALTER COLUMN "by_team_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD COLUMN "assignment_id" text;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_one_grantor" CHECK ((by_team_member_id is null) <> (assignment_id is null));--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_amount" CHECK (amount_microcredits > 0 or (assignment_id is not null and amount_microcredits < 0));
