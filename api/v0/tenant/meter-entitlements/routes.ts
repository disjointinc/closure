/**
 * v0/tenant/meter-entitlements/routes.ts -- HTTP for
 * /v0/tenant/:tenantId/meter-entitlements. Business logic lives in
 * service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { microcredits } from "../../../schemas/common.ts";
import { meterIdSchema } from "../../../schemas/ids.ts";
import { getMeterEntitlements } from "./service.ts";

const meterEntitlementsSchema = z.array(
  z.object({
    meterId: meterIdSchema,
    defaultMicrocredits: microcredits,
    limitMicrocredits: microcredits.nullable(),
  }),
);

const getMeterEntitlementsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/meter-entitlements"],
  summary: "Get a tenant's resolved meter entitlements",
  responses: {
    200: {
      content: { "application/json": { schema: meterEntitlementsSchema } },
      description: "OK",
    },
  },
});

export const meterEntitlementsApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>().openapi(getMeterEntitlementsRoute, async (c) => {
  return c.json(
    await getMeterEntitlements({ tenantId: c.get("tenantId") }),
    200,
  );
});
