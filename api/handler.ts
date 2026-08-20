/**
 * handler.ts -- Closure's business logic.
 *
 * Deploy-agnostic on purpose: the hobby deploy serves this app over node:http
 * (api/server.ts, via @hono/node-server). Keep HTTP-server specifics out of this
 * file.
 *
 * Routes are chained on a single Hono instance so AppType carries the full
 * route schema -- that is what powers typesafe clients (hono/client's hc).
 */

import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/index.ts";

const app = new Hono()
  .get("/", (c) => c.text("hello world\n"))
  .get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.text("ok\n");
    } catch {
      return c.text("db unavailable\n", 503);
    }
  })
  .notFound((c) => c.text("not found\n", 404));

export type AppType = typeof app;
export default app;
