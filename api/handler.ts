/**
 * handler.ts -- Closure's HTTP API surface.
 *
 * Deploy-agnostic on purpose: the hobby deploy serves this app over node:http
 * (api/server.ts, via @hono/node-server). Keep HTTP-server specifics out of
 * this file.
 *
 * Versioned resources live under v0/<resource>/: routes.ts holds the HTTP
 * concerns (request validation, wiring; rate limiting and auth when added),
 * service.ts holds the business logic.
 *
 * Routes are chained on a single OpenAPIHono instance so AppType carries the
 * full route schema -- that is what powers typesafe clients (hono/client's
 * hc) -- and the OpenAPI doc is derived from the same definitions. /openapi.json
 * serves the doc; bin/openapi.ts writes it out statically for the docs site.
 * Mounts are alphabetical after /, /healthz, and /openapi.json.
 */

import { sql } from "drizzle-orm";
import { cors } from "hono/cors";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "./db/index.ts";
import { addOnTypeApp } from "./v0/add-on-type/routes.ts";
import { couponApp } from "./v0/coupon/routes.ts";
import { couponTemplateApp } from "./v0/coupon-template/routes.ts";
import { cycleApp } from "./v0/cycle/routes.ts";
import { experimentApp } from "./v0/experiment/routes.ts";
import { featureApp } from "./v0/feature/routes.ts";
import { loanTemplateApp } from "./v0/loan-template/routes.ts";
import { meterApp } from "./v0/meter/routes.ts";
import { planApp } from "./v0/plan/routes.ts";
import { productLineApp } from "./v0/product-line/routes.ts";
import { ruleApp } from "./v0/rule/routes.ts";
import { taxApp } from "./v0/tax/routes.ts";
import { taxTypeApp } from "./v0/tax-type/routes.ts";
import { teamMemberApp } from "./v0/team-member/routes.ts";
import { tenantApp } from "./v0/tenant/routes.ts";
import { taskTypeApp } from "./v0/task-type/routes.ts";

const apiDoc = {
  openapi: "3.1.0" as const, // determined by OpenAPIHono version choice
  info: {
    title: "Closure API",
    version: "v0",
    description:
      "The primitives for real-time, configurable metering, entitlements, " +
      "pricing, referrals, and billing.",
  },
  servers: [{ url: "http://localhost:3216", description: "Local dev" }],
};

/* apiApp stays typed as OpenAPIHono so the doc generator remains accessible
 * after the chained union type erases it; Hono mutates and returns the same
 * runtime instance, so app and apiApp are the same object. */
const apiApp = new OpenAPIHono();
const app = apiApp
  // Browser calls from the web console are cross-origin in the dev stack.
  .use("*", cors())
  .get("/", (c) => c.text("hello world\n"))
  .get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.text("ok\n");
    } catch {
      return c.text("db unavailable\n", 503);
    }
  })
  .route("/v0/add-on-type", addOnTypeApp)
  .route("/v0/coupon", couponApp)
  .route("/v0/coupon-template", couponTemplateApp)
  .route("/v0/cycle", cycleApp)
  .route("/v0/experiment", experimentApp)
  .route("/v0/feature", featureApp)
  .route("/v0/loan-template", loanTemplateApp)
  .route("/v0/meter", meterApp)
  .route("/v0/plan", planApp)
  .route("/v0/product-line", productLineApp)
  .route("/v0/rule", ruleApp)
  .route("/v0/task-type", taskTypeApp)
  .route("/v0/tax", taxApp)
  .route("/v0/tax-type", taxTypeApp)
  .route("/v0/team-member", teamMemberApp)
  .route("/v0/tenant", tenantApp)
  .notFound((c) => c.json({ error: "not found" }, 404));

/** The spec as served live and written out by bin/openapi.ts. */
export const getApiDoc = () => apiApp.getOpenAPI31Document(apiDoc);

const api = app.get("/openapi.json", (c) => {
  return c.json(getApiDoc());
});

export type AppType = typeof api;
export default api;
