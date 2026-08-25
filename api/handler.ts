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
import { addOnsApp } from "./routes/add_ons.ts";
import { couponsApp } from "./routes/coupons.ts";
import { experimentsApp } from "./routes/experiments.ts";
import { featuresApp } from "./routes/features.ts";
import { metersApp } from "./routes/meters.ts";
import { plansApp } from "./routes/plans.ts";
import { taxesApp } from "./routes/taxes.ts";
import { teamMembersApp } from "./routes/team_members.ts";
import { tenantsApp } from "./routes/tenants.ts";

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
  .route("/features", featuresApp)
  .route("/meters", metersApp)
  .route("/plans", plansApp)
  .route("/add-ons", addOnsApp)
  .route("/coupons", couponsApp)
  .route("/taxes", taxesApp)
  .route("/experiments", experimentsApp)
  .route("/team-members", teamMembersApp)
  .route("/tenants", tenantsApp)
  .notFound((c) => c.json({ error: "not found" }, 404));

export type AppType = typeof app;
export default app;
