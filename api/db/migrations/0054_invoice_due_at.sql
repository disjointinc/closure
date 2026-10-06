ALTER TABLE "invoices" ADD COLUMN "due_at" bigint;--> statement-breakpoint
-- Invoices finalized before due_at existed are dev data only (nothing runs
-- in production yet). They get their due date from Postgres's month math,
-- which differs from finalizeInvoice's only for a months-long credit
-- period that starts on the last day of a month.
UPDATE "invoices"
SET "due_at" = CASE
  WHEN "credit_period" IS NULL THEN "finalized_at"
  WHEN "credit_period"->>'days' IS NOT NULL
    THEN "finalized_at" + ("credit_period"->>'days')::bigint * 86400000
  ELSE (extract(epoch FROM
    (to_timestamp("finalized_at" / 1000.0) AT TIME ZONE 'UTC')
    + make_interval(months => ("credit_period"->>'months')::int)
  ) * 1000)::bigint
END
WHERE "finalized_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_due" ON "invoices" USING btree ("due_at","invoice_id") WHERE "invoices"."due_at" is not null;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_due_at_with_finalized_at" CHECK ((finalized_at is null) = (due_at is null));
