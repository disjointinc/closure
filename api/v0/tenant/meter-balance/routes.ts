/**
 * v0/tenant/meter-balance/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-balance.
 * Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { meterIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import { getBalance } from "./service.ts";

// balanceMicrocredits is null when the meter's balance key is absent.
const meterBalanceSchema = z.object({
  tenantId: tenantIdSchema,
  meterId: meterIdSchema,
  balanceMicrocredits: z.number().int().nullable(),
});

const getMeterBalanceRoute = createRoute({
  method: "get",
  path: "/{meterId}",
  tags: ["tenant/meter-balance"],
  summary: "Get a meter balance",
  request: {
    params: z.object({ meterId: meterIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: meterBalanceSchema } },
      description: "OK",
    },
  },
});

export const meterBalanceApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>().openapi(getMeterBalanceRoute, async (c) => {
  const tenantId = c.get("tenantId");
  const meterId = c.req.param("meterId");
  return c.json(
    {
      tenantId,
      meterId,
      balanceMicrocredits: await getBalance({ meterId, tenantId }),
    },
    200,
  );
});
