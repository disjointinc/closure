ALTER TABLE "loans" DROP COLUMN "written_off_at";--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "write_off_id" text;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_write_off_id_loan_write_offs_write_off_id_fk" FOREIGN KEY ("write_off_id") REFERENCES "public"."loan_write_offs"("write_off_id") ON DELETE no action ON UPDATE no action;
