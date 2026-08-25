/**
 * v0/feature/routes.ts -- HTTP for /v0/feature: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { featureSchema } from "../../schemas/feature.ts";
import {
  createFeature,
  deprecateFeature,
  getFeature,
  listFeatures,
} from "./service.ts";

export const featureApp = new Hono()
  .post("/", zValidator("json", featureSchema), async (c) => {
    const body = c.req.valid("json");
    await createFeature({ feature: body });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listFeatures());
  })
  .get("/:id", async (c) => {
    const feature = await getFeature({ uniqueId: c.req.param("id") });
    if (!feature) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(feature);
  })
  .delete("/:id", async (c) => {
    const feature = await deprecateFeature({ uniqueId: c.req.param("id") });
    if (!feature) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(feature);
  });
