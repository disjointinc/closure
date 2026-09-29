CREATE TABLE "billing_periods" (
	"tenant_id" text NOT NULL,
	"product_line_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"period_start" bigint NOT NULL,
	"period_end" bigint NOT NULL,
	"window_ms" bigint NOT NULL,
	"is_current" boolean NOT NULL,
	CONSTRAINT "billing_periods_tenant_id_product_line_id_period_start_pk" PRIMARY KEY("tenant_id","product_line_id","period_start")
);
--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_product_line_id_product_lines_product_line_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("product_line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_periods_end" ON "billing_periods" USING btree ("period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_periods_one_current_per_line" ON "billing_periods" USING btree ("tenant_id","product_line_id") WHERE "billing_periods"."is_current";--> statement-breakpoint
CREATE INDEX "tenant_last_activity_meter_stale" ON "tenant_last_activity" USING btree ("meter_id","last_event_at_micros");