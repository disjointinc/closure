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

import { Hono } from "hono";

const app = new Hono()
  .get("/", (c) => c.text("hello world\n"))
  .notFound((c) => c.text("not found\n", 404));

export type AppType = typeof app;
export default app;
