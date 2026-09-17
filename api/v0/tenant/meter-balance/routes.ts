/**
 * v0/tenant/meter-balance/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-balance.
 * Business logic lives in service.ts.
 *
 * The wire speaks fractional credits; the service speaks microcredits.
 * Handlers convert at the boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { credits, microcreditsToCredits } from "../../../lib/credits.ts";
import { meterIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import { getBalance } from "./service.ts";

// balanceCredits is null when the meter's balance key is absent.
const meterBalanceWireSchema = z.object({
  tenantId: tenantIdSchema,
  meterId: meterIdSchema,
  balanceCredits: credits.nullable(),
});

const getMeterBalanceRoute = createRoute({
  method: "get",
  path: "/{meterId}",
  tags: ["Tenant > Meter balance"],
  summary: "Get a meter balance",
  request: {
    params: z.object({ meterId: meterIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: meterBalanceWireSchema } },
      description: "OK",
    },
  },
});

export const meterBalanceApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>().openapi(getMeterBalanceRoute, async (c) => {
  const tenantId = c.get("tenantId");
  const meterId = c.req.param("meterId");
  const balanceMicrocredits = await getBalance({ meterId, tenantId });
  return c.json(
    {
      tenantId,
      meterId,
      balanceCredits:
        balanceMicrocredits === null
          ? null
          : microcreditsToCredits({ microcredits: balanceMicrocredits }),
    },
    200,
  );
});
