/**
 * v0/cycle/routes.ts -- HTTP for /v0/cycle: listing, so pickers can
 * enumerate existing cycles. Everything else composes cycles inline into
 * other resources (see service.ts).
 */
import { Hono } from "hono";
import { listCycles } from "./service.ts";

export const cycleApp = new Hono().get("/", async (c) => {
  return c.json(await listCycles());
});
