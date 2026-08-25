/**
 * v0/meter-overrides/routes.ts -- HTTP for /v0/tenants/:id/meter-overrides:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { meterOverrideSchema } from "../../schemas/meter-override.ts";
import { tenantParam } from "../helpers.ts";
import { createMeterOverride, listMeterOverrides } from "./service.ts";

export const meterOverridesApp = new Hono()
  .post("/", zValidator("json", meterOverrideSchema), async (c) => {
    const tenantId = tenantParam(c);
    const body = c.req.valid("json");
    await createMeterOverride({ override: body, tenantId });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listMeterOverrides({ tenantId: tenantParam(c) }));
  });
