/**
 * v0/feature/routes.ts -- HTTP for /v0/feature: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { featureOptionSchema } from "../../schemas/feature-option.ts";
import { featureSchema } from "../../schemas/feature.ts";
import { featureIdSchema } from "../../schemas/ids.ts";
import {
  createFeature,
  deprecateFeature,
  getFeature,
  listFeatures,
} from "./service.ts";

const featureOptionCreateSchema = featureOptionSchema.omit({
  featureOptionId: true,
});

const featureCreateSchema = featureSchema
  .omit({
    createdAt: true,
    deprecatedAt: true,
    featureId: true,
    options: true,
  })
  .extend({
    /** If options is null, this is a boolean feature. */
    options: z.array(featureOptionCreateSchema).min(1).nullable(),
  });

export type FeatureCreateBody = z.infer<typeof featureCreateSchema>;

const createFeatureRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["feature"],
  summary: "Create a feature",
  request: {
    body: {
      content: { "application/json": { schema: featureCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: featureSchema } },
      description: "Created",
    },
  },
});

const listFeaturesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["feature"],
  summary: "List features",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(featureSchema) } },
      description: "OK",
    },
  },
});

const getFeatureRoute = createRoute({
  method: "get",
  path: "/{featureId}",
  tags: ["feature"],
  summary: "Get a feature",
  request: { params: z.object({ featureId: featureIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: featureSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateFeatureRoute = createRoute({
  method: "delete",
  path: "/{featureId}",
  tags: ["feature"],
  summary: "Deprecate a feature",
  request: { params: z.object({ featureId: featureIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: featureSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const featureApp = new OpenAPIHono()
  .openapi(createFeatureRoute, async (c) => {
    return c.json(await createFeature({ feature: c.req.valid("json") }), 201);
  })
  .openapi(listFeaturesRoute, async (c) => {
    return c.json(await listFeatures(), 200);
  })
  .openapi(getFeatureRoute, async (c) => {
    const feature = await getFeature({ featureId: c.req.param("featureId") });
    if (!feature) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(feature, 200);
  })
  .openapi(deprecateFeatureRoute, async (c) => {
    const feature = await deprecateFeature({
      featureId: c.req.param("featureId"),
    });
    if (!feature) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(feature, 200);
  });
