/**
 * v0/meter/routes.ts -- HTTP for /v0/meter: request validation and wiring.
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

export const meterApp = new Hono()
  .post("/", zValidator("json", meterSchema), async (c) => {
    const body = c.req.valid("json");
    await createMeter({ meter: body });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listMeters());
  })
  .get("/:meterId", async (c) => {
    const meter = await getMeter({ meterId: c.req.param("meterId") });
    if (!meter) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(meter);
  })
  .delete("/:meterId", async (c) => {
    const meter = await deprecateMeter({ meterId: c.req.param("meterId") });
    if (!meter) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(meter);
  });
