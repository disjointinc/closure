ALTER TABLE "integrations" DROP CONSTRAINT "integrations_credentials_variant";--> statement-breakpoint
ALTER TABLE "integrations" DROP COLUMN "secrets_key_version";--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_credentials_variant" CHECK ((system = 'webhook'
          and webhook_url is not null
          and secrets_ciphertext is not null
          and nango_provider_config_key is null
          and nango_connection_id is null)
       or (system <> 'webhook'
          and nango_provider_config_key is not null
          and nango_connection_id is not null
          and webhook_url is null
          and secrets_ciphertext is null));