-- Each credit grant records when rules were evaluated against the balance
-- it left, and the reconciler evaluates any applied grant that has no such
-- time. Existing grants count as evaluated when they were granted, so the
-- reconciler doesn't go back over them.
ALTER TABLE "credit_grants" ADD COLUMN "rules_evaluated_at" bigint;--> statement-breakpoint
UPDATE "credit_grants" SET "rules_evaluated_at" = "granted_at";--> statement-breakpoint
CREATE INDEX "credit_grants_rules_unevaluated" ON "credit_grants" USING btree ("applied_at_microseconds") WHERE "credit_grants"."rules_evaluated_at" is null;
