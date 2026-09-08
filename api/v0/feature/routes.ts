/**
 * v0/feature/routes.ts -- HTTP for /v0/feature: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { featureOptionSchema } from "../../schemas/feature-option.ts";
import { featureSchema } from "../../schemas/feature.ts";
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

export const featureApp = new Hono()
  .post("/", zValidator("json", featureCreateSchema), async (c) => {
    return c.json(await createFeature({ feature: c.req.valid("json") }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listFeatures());
  })
  .get("/:featureId", async (c) => {
    const feature = await getFeature({ featureId: c.req.param("featureId") });
    if (!feature) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(feature);
  })
  .delete("/:featureId", async (c) => {
    const feature = await deprecateFeature({
      featureId: c.req.param("featureId"),
    });
    if (!feature) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(feature);
  });
