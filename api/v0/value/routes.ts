/**
 * v0/value/routes.ts -- HTTP for /v0/value: listing, so pickers can
 * enumerate existing values. Everything else composes values inline into
 * other resources (see service.ts).
 */
import { Hono } from "hono";
import { listValues } from "./service.ts";

export const valueApp = new Hono().get("/", async (c) => {
  return c.json(await listValues());
});
