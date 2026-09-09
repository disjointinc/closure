/**
 * v0/tenant/feature-override/routes.ts -- HTTP for
 * /v0/tenant/:tenantId/feature-override: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { featureOverrideSchema } from "../../../schemas/feature-override.ts";
import { createFeatureOverride, listFeatureOverrides } from "./service.ts";

/** The tenant is the one in the path. */
const featureOverrideCreateSchema = featureOverrideSchema.omit({
  createdAt: true,
  featureOverrideId: true,
  tenantId: true,
});

export type FeatureOverrideCreateBody = z.infer<
  typeof featureOverrideCreateSchema
>;

export const featureOverrideApp = new Hono<{
  Variables: { tenantId: string };
}>()
  .post("/", zValidator("json", featureOverrideCreateSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const override = await createFeatureOverride({ override: body, tenantId });
    return c.json(override, 201);
  })
  .get("/", async (c) => {
    return c.json(await listFeatureOverrides({ tenantId: c.get("tenantId") }));
  });
