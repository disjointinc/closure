/**
 * v0/cycle/routes.ts -- HTTP for /v0/cycle: creation, listing, get, and
 * deprecate. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  createCycle,
  cycleApiSchema,
  deprecateCycle,
  getCycle,
  listCycles,
} from "./service.ts";

export const cycleApp = new Hono()
  .post("/", zValidator("json", cycleApiSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createCycle({ cycle: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listCycles());
  })
  .get("/:cycleId", async (c) => {
    const cycle = await getCycle({ cycleId: c.req.param("cycleId") });
    if (!cycle) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(cycle);
  })
  .delete("/:cycleId", async (c) => {
    const cycle = await deprecateCycle({ cycleId: c.req.param("cycleId") });
    if (!cycle) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(cycle);
  });
