-- Product lines gain billing-cycle synchronization edges; meters become
-- multi-line. Existing meter rows keep their line as a one-element array.
ALTER TABLE "product_lines" ADD COLUMN "force_billing_cycle_synchronization_with_product_line_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "meters" DROP CONSTRAINT "meters_product_line_id_product_lines_product_line_id_fk";--> statement-breakpoint
ALTER TABLE "meters" ADD COLUMN "product_line_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "meters" SET "product_line_ids" = ARRAY["product_line_id"];--> statement-breakpoint
ALTER TABLE "meters" DROP COLUMN "product_line_id";
