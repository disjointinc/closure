ALTER TABLE "invoices" RENAME COLUMN "closed_at" TO "finalized_at";--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "closed_reason" TO "finalized_reason";--> statement-breakpoint
DROP INDEX "invoices_closed";--> statement-breakpoint
CREATE INDEX "invoices_finalized" ON "invoices" USING btree ("finalized_at") WHERE "invoices"."finalized_at" is not null;--> statement-breakpoint
UPDATE "rules" SET "trigger" = jsonb_set("trigger", '{relativeTo}', '"invoice_finalized"') WHERE "trigger"->>'relativeTo' = 'invoice_closed';
