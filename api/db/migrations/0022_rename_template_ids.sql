ALTER TABLE "coupons" RENAME COLUMN "template_id" TO "coupon_template_id";--> statement-breakpoint
ALTER TABLE "coupons" RENAME CONSTRAINT "coupons_template_id_coupon_templates_coupon_template_id_fk" TO "coupons_coupon_template_id_coupon_templates_coupon_template_id_fk";--> statement-breakpoint
ALTER TABLE "loans" RENAME COLUMN "template_id" TO "loan_template_id";--> statement-breakpoint
ALTER TABLE "loans" RENAME CONSTRAINT "loans_template_id_loan_templates_loan_template_id_fk" TO "loans_loan_template_id_loan_templates_loan_template_id_fk";
