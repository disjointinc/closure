CREATE TABLE "tenant_last_activity" (
	"tenant_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"last_event_at_micros" bigint NOT NULL,
	CONSTRAINT "tenant_last_activity_tenant_id_meter_id_pk" PRIMARY KEY("tenant_id","meter_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_last_activity" ADD CONSTRAINT "tenant_last_activity_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_last_activity" ADD CONSTRAINT "tenant_last_activity_meter_id_meters_meter_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("meter_id") ON DELETE no action ON UPDATE no action;