/**
 * v0/tenant/meter-override/routes.ts -- HTTP for /v0/tenant/:id/meter-override:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { meterOverrideSchema } from "../../../schemas/meter-override.ts";
import { createMeterOverride, listMeterOverrides } from "./service.ts";

export const meterOverrideApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", meterOverrideSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    await createMeterOverride({ override: body, tenantId });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listMeterOverrides({ tenantId: c.get("tenantId") }));
  });
