-- A meter belongs to exactly one product line, the same as a feature:
-- product_line_ids (a list) becomes product_line_id, with a foreign key.
-- No meter in production spans several product lines; one that did would
-- keep its first.
ALTER TABLE "meters" ADD COLUMN "product_line_id" text;--> statement-breakpoint
UPDATE "meters" SET "product_line_id" = "product_line_ids"[1];--> statement-breakpoint
ALTER TABLE "meters" ALTER COLUMN "product_line_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" DROP COLUMN "product_line_ids";
