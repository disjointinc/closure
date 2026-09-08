CREATE TABLE "loan_templates" (
	"loan_template_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	"principal" jsonb NOT NULL,
	"interest_percentage" double precision NOT NULL,
	CONSTRAINT "loan_template_id_format" CHECK ("loan_templates"."loan_template_id" ~ '^loan_template_[a-z0-9]{20}$')
);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_template_id_loan_templates_loan_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."loan_templates"("loan_template_id") ON DELETE no action ON UPDATE no action;