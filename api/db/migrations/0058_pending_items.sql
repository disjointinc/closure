-- Items can exist before an invoice takes them (pending), so each item now
-- records its own tenant, product line and creation time. Existing items
-- take their tenant and creation time from their invoice; none of them is
-- for a product line.
ALTER TABLE "items" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "product_line_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "product_line_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "created_at" bigint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "voided_at" bigint;--> statement-breakpoint
UPDATE "items"
SET "tenant_id" = "invoices"."tenant_id", "created_at" = "invoices"."created_at"
FROM "invoices"
WHERE "invoices"."invoice_id" = "items"."invoice_id";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_tenant" ON "items" USING btree ("tenant_id","created_at");
