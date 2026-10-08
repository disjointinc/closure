import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { postgresUrl } from "../../config.ts";
import * as schema from "./schema.ts";

/*
 * The slowest statements measured in this codebase take well under a second
 * (a full page of billing period advancing is ~50ms, a full page of firings
 * ~180ms), and no transaction waits on anything but its own statements. 30s
 * is over 100x that, so these only ever cut off something stuck. Migrations
 * use their own client (db/migrate.ts).
 */
const STATEMENT_TIMEOUT_MS = 30_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

export const db = drizzle(
  postgres(postgresUrl, {
    connection: {
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    },
  }),
  { schema },
);
