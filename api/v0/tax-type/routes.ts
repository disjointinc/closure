/**
 * v0/tax-type/routes.ts -- HTTP for /v0/tax-type: listing, so pickers can
 * enumerate existing tax types. Everything else composes tax types inline
 * into taxes (see service.ts).
 */
import { Hono } from "hono";
import { listTaxTypes } from "./service.ts";

export const taxTypeApp = new Hono().get("/", async (c) => {
  return c.json(await listTaxTypes());
});
