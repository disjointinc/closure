/*
 * Load bin/.env (written by bin/generate-env, plus the Hatchet token
 * bin/compose.yml's closure-hatchet-token adds), so the API and the tests and
 * scripts run from the host all use the same passwords and keys. Variables
 * already set take precedence. A missing file is fine here: settings with
 * defaults below fall back to them, and api/lib/secrets.ts refuses to start
 * without a secrets key.
 */
try {
  process.loadEnvFile(new URL("./bin/.env", import.meta.url));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    console.error("could not load bin/.env", { error });
  }
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function envPort(key: string, fallback: number): number {
  const raw = env(key, String(fallback));
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port in ${key}: ${JSON.stringify(raw)}`);
  }
  return port;
}

function envBoolean(key: string, fallback: boolean): boolean {
  const raw = env(key, String(fallback));
  if (raw !== "true" && raw !== "false") {
    throw new Error(`invalid boolean in ${key}: ${JSON.stringify(raw)}`);
  }
  return raw === "true";
}

export const config = {
  postgres: {
    host: env("CLOSURE_POSTGRES_HOST", "localhost"),
    port: envPort("CLOSURE_POSTGRES_PORT", 54326),
    user: env("CLOSURE_POSTGRES_USER", "postgres"),
    password: env("CLOSURE_POSTGRES_PASSWORD", "password"),
    database: env("CLOSURE_POSTGRES_DB", "closure_local"),
  },
  redis: {
    host: env("CLOSURE_REDIS_HOST", "localhost"),
    port: envPort("CLOSURE_REDIS_PORT", 63796),
    password: env("CLOSURE_REDIS_PASSWORD", "password"),
  },
  api: {
    host: env("CLOSURE_API_HOST", "0.0.0.0"),
    port: envPort("CLOSURE_API_PORT", 3216),
  },
  web: {
    host: env("CLOSURE_WEB_HOST", "0.0.0.0"),
    port: envPort("CLOSURE_WEB_PORT", 3226),
  },
  secrets: {
    // No default: api/lib/secrets.ts refuses to start without one.
    key: env("CLOSURE_SECRETS_KEY", ""),
  },
  hatchet: {
    host: env("CLOSURE_HATCHET_HOST", "localhost"),
    port: envPort("CLOSURE_HATCHET_PORT", 3246),
    grpcPort: envPort("CLOSURE_HATCHET_GRPC_PORT", 3247),
    clientToken: env("CLOSURE_HATCHET_CLIENT_TOKEN", ""),
    /* Prefixes Closure's Hatchet task names. Tests set their own (see
     * api/vitest.config.ts) so their runs never reach the dev server's
     * worker, which can't reach the tests' local endpoints. */
    namespace: env("CLOSURE_HATCHET_NAMESPACE", ""),
  },
  nango: {
    host: env("CLOSURE_NANGO_HOST", "localhost"),
    port: envPort("CLOSURE_NANGO_PORT", 3256),
    // Must match NANGO_SECRET_KEY_PROD on closure-nango (bin/compose.yml).
    secretKey: env(
      "CLOSURE_NANGO_SECRET_KEY",
      "00000000-0000-4000-8000-000000000000",
    ),
  },
  outbound: {
    /*
     * Whether integrations may call private-network or plain-http URLs.
     * Off by default: on a shared deploy, letting a user point a webhook at
     * an internal address lets them reach systems they shouldn't. A
     * self-hosted deploy that delivers to its own internal systems turns it
     * on.
     */
    allowPrivateNetworks: envBoolean(
      "CLOSURE_OUTBOUND_ALLOW_PRIVATE_NETWORKS",
      false,
    ),
  },
} as const;

export type Config = typeof config;

export const postgresUrl = `postgres://${config.postgres.user}:${encodeURIComponent(config.postgres.password)}@${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`;

export const redisUrl = `redis://:${encodeURIComponent(config.redis.password)}@${config.redis.host}:${config.redis.port}`;
