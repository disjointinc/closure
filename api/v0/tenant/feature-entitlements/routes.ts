/**
 * v0/tenant/feature-entitlements/routes.ts -- HTTP for
 * /v0/tenant/:tenantId/feature-entitlements. Business logic lives in
 * service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { featureSetTo } from "../../../schemas/common.ts";
import { featureIdSchema } from "../../../schemas/ids.ts";
import { getFeatureEntitlements } from "./service.ts";

const featureEntitlementsSchema = z.array(
  z.object({ featureId: featureIdSchema, setTo: featureSetTo }),
);

const getFeatureEntitlementsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/feature-entitlements"],
  summary: "Get a tenant's resolved feature entitlements",
  responses: {
    200: {
      content: {
        "application/json": { schema: featureEntitlementsSchema },
      },
      description: "OK",
    },
  },
});

export const featureEntitlementsApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>().openapi(getFeatureEntitlementsRoute, async (c) => {
  return c.json(
    await getFeatureEntitlements({ tenantId: c.get("tenantId") }),
    200,
  );
});
