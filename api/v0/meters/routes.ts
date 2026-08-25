/**
 * v0/meters/routes.ts -- HTTP for /v0/meters: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { meterSchema } from "../../schemas/meter.ts";
import {
  createMeter,
  deprecateMeter,
  getMeter,
  listMeters,
} from "./service.ts";

export const metersApp = new Hono()
  .post("/", zValidator("json", meterSchema), async (c) => {
    const body = c.req.valid("json");
    await createMeter({ meter: body });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listMeters());
  })
  .get("/:id", async (c) => {
    const meter = await getMeter({ uniqueId: c.req.param("id") });
    if (!meter) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(meter);
  })
  .delete("/:id", async (c) => {
    const meter = await deprecateMeter({ uniqueId: c.req.param("id") });
    if (!meter) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(meter);
  });
