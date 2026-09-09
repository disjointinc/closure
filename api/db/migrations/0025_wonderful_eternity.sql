-- Product lines hard-lock features/meters/plans/add-on types with NOT NULL
-- columns; pre-product-line data can't be parented mechanically, so it's dropped.
TRUNCATE add_on_types, features, meters, plans, assignments CASCADE;
--> statement-breakpoint
CREATE TABLE "product_lines" (
	"product_line_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "product_line_id_format" CHECK ("product_lines"."product_line_id" ~ '^product_line_[a-z0-9]{20}$')
);
--> statement-breakpoint
ALTER TABLE "add_on_types" ADD COLUMN "product_line_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "product_line_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "product_line_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "meters" ADD COLUMN "product_line_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "product_line_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "add_on_types" ADD CONSTRAINT "add_on_types_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_open_per_line" ON "assignments" USING btree ("tenant_id","product_line_id") WHERE "assignments"."ends_at" is null;