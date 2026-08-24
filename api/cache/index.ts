/**
 * cache/index.ts -- the shared Redis client.
 *
 * Redis is Closure's hot path for metering: balance checks and decrements
 * happen here atomically (see metering.ts), and meter events are buffered
 * for batched writes to Postgres, so a high volume of concurrent metering
 * traffic never touches pg per-event.
 */
import { Redis } from "ioredis";
import { redisUrl } from "../../config.ts";

export const redis = new Redis(redisUrl, {
  // Fail fast when Redis is down: retry a command briefly, then reject it
  // rather than letting metering traffic pile up in memory.
  maxRetriesPerRequest: 2,
});
