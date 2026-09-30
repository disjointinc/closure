ALTER TABLE "billing_periods" DROP CONSTRAINT "billing_periods_assignment_id_assignments_assignment_id_fk";
--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE cascade ON UPDATE no action;