DROP INDEX "invoices_tenant_closed";--> statement-breakpoint
CREATE INDEX "invoices_closed" ON "invoices" USING btree ("closed_at") WHERE "invoices"."closed_at" is not null;