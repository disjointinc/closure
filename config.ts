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

const environment = env("CLOSURE_ENV", "development");

export const config = {
  environment,
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
} as const;

export type Config = typeof config;

export const postgresUrl = `postgres://${config.postgres.user}:${encodeURIComponent(config.postgres.password)}@${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`;

export const redisUrl = `redis://:${encodeURIComponent(config.redis.password)}@${config.redis.host}:${config.redis.port}`;
