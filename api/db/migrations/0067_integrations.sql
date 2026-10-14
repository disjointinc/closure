CREATE TYPE "public"."integration_system" AS ENUM('slack', 'teams', 'linear', 'jira', 'webhook');--> statement-breakpoint
CREATE TABLE "integrations" (
	"integration_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"deprecated_at" bigint,
	"name" text NOT NULL,
	"system" "integration_system" NOT NULL,
	"rate_limit" jsonb NOT NULL,
	"nango_provider_config_key" text,
	"nango_connection_id" text,
	"webhook_url" text,
	"secrets_key_version" integer,
	"secrets_ciphertext" text,
	CONSTRAINT "integration_id_format" CHECK ("integrations"."integration_id" ~ '^integration_[a-z0-9]{20}$'),
	CONSTRAINT "integrations_credentials_variant" CHECK ((system = 'webhook'
          and webhook_url is not null
          and secrets_key_version is not null
          and secrets_ciphertext is not null
          and nango_provider_config_key is null
          and nango_connection_id is null)
       or (system <> 'webhook'
          and nango_provider_config_key is not null
          and nango_connection_id is not null
          and webhook_url is null
          and secrets_key_version is null
          and secrets_ciphertext is null))
);
--> statement-breakpoint
-- Task types now route to integrations by id ({ integrationId, target }).
-- The old entries ({ system, channel | teamKey | projectKey }) only worked
-- through per-channel env vars and can't be mapped to an integration, so
-- they're cleared; re-add routes once the integrations exist.
UPDATE "task_types" SET "integrations" = '[]'::jsonb WHERE "integrations" <> '[]'::jsonb;
