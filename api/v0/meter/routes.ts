/**
 * v0/meter/routes.ts -- HTTP for /v0/meter: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { meterSchema } from "../../schemas/meter.ts";
import {
  createMeter,
  deprecateMeter,
  getMeter,
  listMeters,
} from "./service.ts";

const meterCreateSchema = meterSchema.omit({
  createdAt: true,
  deprecatedAt: true,
  meterId: true,
});

export type MeterCreateBody = z.infer<typeof meterCreateSchema>;

export const meterApp = new Hono()
  .post("/", zValidator("json", meterCreateSchema), async (c) => {
    return c.json(await createMeter({ meter: c.req.valid("json") }), 201);
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
