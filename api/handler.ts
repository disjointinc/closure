/**
 * handler.ts -- Closure's HTTP API surface.
 *
 * Deploy-agnostic on purpose: the hobby deploy serves this app over node:http
 * (api/server.ts, via @hono/node-server). Keep HTTP-server specifics out of this
 * file.
 *
 * Versioned resources live under v0/<resource>/: routes.ts holds the HTTP
 * concerns (request validation, wiring; rate limiting and auth when added),
 * service.ts holds the business logic.
 *
 * Routes are chained on a single Hono instance so AppType carries the full
 * route schema -- that is what powers typesafe clients (hono/client's hc).
 * Mounts are alphabetical after / and /healthz.
 */

import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/index.ts";
import { addOnsApp } from "./v0/add-ons/routes.ts";
import { couponTemplatesApp } from "./v0/coupon-templates/routes.ts";
import { couponsApp } from "./v0/coupons/routes.ts";
import { experimentsApp } from "./v0/experiments/routes.ts";
import { featuresApp } from "./v0/features/routes.ts";
import { metersApp } from "./v0/meters/routes.ts";
import { plansApp } from "./v0/plans/routes.ts";
import { taxesApp } from "./v0/taxes/routes.ts";
import { teamMembersApp } from "./v0/team-members/routes.ts";
import { tenantsApp } from "./v0/tenants/routes.ts";

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
  .route("/v0/add-ons", addOnsApp)
  .route("/v0/coupon-templates", couponTemplatesApp)
  .route("/v0/coupons", couponsApp)
  .route("/v0/experiments", experimentsApp)
  .route("/v0/features", featuresApp)
  .route("/v0/meters", metersApp)
  .route("/v0/plans", plansApp)
  .route("/v0/taxes", taxesApp)
  .route("/v0/team-members", teamMembersApp)
  .route("/v0/tenants", tenantsApp)
  .notFound((c) => c.json({ error: "not found" }, 404));

export type AppType = typeof app;
export default app;
