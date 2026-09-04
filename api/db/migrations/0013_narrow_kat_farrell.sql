CREATE TABLE "rule_runs" (
	"rule_run_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"rule_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"trigger_key" text NOT NULL,
	"action_index" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" bigint NOT NULL,
	"succeeded_at" bigint,
	"failed_at" bigint,
	"last_error" text,
	CONSTRAINT "rule_run_id_format" CHECK ("rule_runs"."rule_run_id" ~ '^rule_run_[a-z0-9]{27}$')
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"scope" jsonb NOT NULL,
	"trigger" jsonb NOT NULL,
	"recurrence" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "rule_id_format" CHECK ("rules"."rule_id" ~ '^rule_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "task_types" (
	"task_type_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"default_assignee_team_member_id" text,
	"integrations" jsonb,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "task_type_id_format" CHECK ("task_types"."task_type_id" ~ '^task_type_[a-z0-9]{20}$')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"task_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"task_type_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"source_rule_id" text,
	"title" text NOT NULL,
	"description" text,
	"assigned_to_team_member_id" text,
	"completed_at" bigint,
	"external_refs" jsonb,
	CONSTRAINT "task_id_format" CHECK ("tasks"."task_id" ~ '^task_[a-z0-9]{25}$')
);
--> statement-breakpoint
ALTER TABLE "cycles" DROP CONSTRAINT "cycles_charging_variant";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_charging_variant";--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_rule_id_rules_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("rule_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_types" ADD CONSTRAINT "task_types_default_assignee_team_member_id_team_members_team_member_id_fk" FOREIGN KEY ("default_assignee_team_member_id") REFERENCES "public"."team_members"("team_member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_type_id_task_types_task_type_id_fk" FOREIGN KEY ("task_type_id") REFERENCES "public"."task_types"("task_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_rule_id_rules_rule_id_fk" FOREIGN KEY ("source_rule_id") REFERENCES "public"."rules"("rule_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_team_member_id_team_members_team_member_id_fk" FOREIGN KEY ("assigned_to_team_member_id") REFERENCES "public"."team_members"("team_member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rule_runs_idempotency" ON "rule_runs" USING btree ("rule_id","tenant_id","trigger_key","action_index");--> statement-breakpoint
CREATE INDEX "rule_runs_pending" ON "rule_runs" USING btree ("available_at");--> statement-breakpoint
CREATE INDEX "tasks_tenant" ON "tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tasks_type" ON "tasks" USING btree ("task_type_id");--> statement-breakpoint
ALTER TABLE "cycles" DROP COLUMN "dunning_schedule";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "dunning_schedule";--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_charging_variant" CHECK ((charged = 'upfront' and credit_period is null and grace_period is null)
     or (charged = 'arrears' and credit_period is not null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_charging_variant" CHECK ((charged = 'upfront' and credit_period is null and grace_period is null)
     or (charged = 'arrears' and credit_period is not null));