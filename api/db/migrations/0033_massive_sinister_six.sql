CREATE TABLE "loan_write_offs" (
	"write_off_id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"code" text NOT NULL,
	"reason" text,
	CONSTRAINT "write_off_id_format" CHECK ("loan_write_offs"."write_off_id" ~ '^write_off_[a-z0-9]{24}$')
);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "written_off_at" bigint;--> statement-breakpoint
ALTER TABLE "loan_write_offs" ADD CONSTRAINT "loan_write_offs_loan_id_loans_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("loan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_write_offs_loan" ON "loan_write_offs" USING btree ("loan_id");