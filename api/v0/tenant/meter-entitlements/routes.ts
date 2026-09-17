/**
 * v0/tenant/meter-entitlements/routes.ts -- HTTP for
 * /v0/tenant/:tenantId/meter-entitlements. Business logic lives in
 * service.ts.
 *
 * The wire speaks fractional credits; the service speaks microcredits.
 * Handlers convert at the boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { credits, microcreditsToCredits } from "../../../lib/credits.ts";
import { meterIdSchema } from "../../../schemas/ids.ts";
import { getMeterEntitlements } from "./service.ts";

const meterEntitlementsWireSchema = z.array(
  z.object({
    meterId: meterIdSchema,
    defaultCredits: credits,
    limitCredits: credits.nullable(),
  }),
);

const getMeterEntitlementsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tenant > Meter entitlements"],
  summary: "Get a tenant's resolved meter entitlements",
  responses: {
    200: {
      content: { "application/json": { schema: meterEntitlementsWireSchema } },
      description: "OK",
    },
  },
});

export const meterEntitlementsApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>().openapi(getMeterEntitlementsRoute, async (c) => {
  const entitlements = await getMeterEntitlements({
    tenantId: c.get("tenantId"),
  });
  return c.json(
    entitlements.map((entitlement) => ({
      meterId: entitlement.meterId,
      defaultCredits: microcreditsToCredits({
        microcredits: entitlement.defaultMicrocredits,
      }),
      limitCredits:
        entitlement.limitMicrocredits === null
          ? null
          : microcreditsToCredits({
              microcredits: entitlement.limitMicrocredits,
            }),
    })),
    200,
  );
});
