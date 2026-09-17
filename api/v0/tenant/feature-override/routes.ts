/**
 * v0/tenant/feature-override/routes.ts -- HTTP for
 * /v0/tenant/:tenantId/feature-override: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
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

const createFeatureOverrideRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tenant > Feature override"],
  summary: "Create a feature override",
  request: {
    body: {
      content: { "application/json": { schema: featureOverrideCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: featureOverrideSchema } },
      description: "Created",
    },
  },
});

const listFeatureOverridesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tenant > Feature override"],
  summary: "List feature overrides",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.array(featureOverrideSchema) },
      },
      description: "OK",
    },
  },
});

export const featureOverrideApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createFeatureOverrideRoute, async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const override = await createFeatureOverride({ override: body, tenantId });
    return c.json(override, 201);
  })
  .openapi(listFeatureOverridesRoute, async (c) => {
    return c.json(
      await listFeatureOverrides({ tenantId: c.get("tenantId") }),
      200,
    );
  });
