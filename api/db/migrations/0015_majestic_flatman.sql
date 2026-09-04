CREATE TABLE "meter_spends" (
	"tenant_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"spend_microcredits" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "meter_spends_tenant_id_meter_id_pk" PRIMARY KEY("tenant_id","meter_id"),
	CONSTRAINT "meter_spends_nonnegative" CHECK (spend_microcredits >= 0)
);
--> statement-breakpoint
CREATE TABLE "rule_scheduler_state" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"evaluated_through_ms" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meter_spends" ADD CONSTRAINT "meter_spends_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_spends" ADD CONSTRAINT "meter_spends_meter_id_meters_meter_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("meter_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_scheduler_state" ADD CONSTRAINT "rule_scheduler_state_rule_id_rules_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("rule_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_tenant_closed" ON "invoices" USING btree ("tenant_id","closed_at");--> statement-breakpoint
CREATE INDEX "meter_events_meter_received" ON "meter_events" USING btree ("meter_id","received_at_micros");--> statement-breakpoint
CREATE INDEX "rule_runs_rule_tenant_created" ON "rule_runs" USING btree ("rule_id","tenant_id","created_at");