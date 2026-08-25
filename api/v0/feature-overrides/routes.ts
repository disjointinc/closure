/**
 * v0/feature-overrides/routes.ts -- HTTP for
 * /v0/tenants/:id/feature-overrides: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { featureOverrideSchema } from "../../schemas/feature-override.ts";
import { createFeatureOverride, listFeatureOverrides } from "./service.ts";

export const featureOverridesApp = new Hono<{
  Variables: { tenantId: string };
}>()
  .post("/", zValidator("json", featureOverrideSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    await createFeatureOverride({ override: body, tenantId });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listFeatureOverrides({ tenantId: c.get("tenantId") }));
  });
