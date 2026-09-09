/**
 * v0/tenant/meter-balance/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-balance.
 * Business logic lives in service.ts.
 */
import { Hono } from "hono";
import { getBalance } from "./service.ts";

export const meterBalanceApp = new Hono<{
  Variables: { tenantId: string };
}>().get("/:meterId", async (c) => {
  const tenantId = c.get("tenantId");
  const meterId = c.req.param("meterId");
  return c.json({
    tenantId,
    meterId,
    balanceMicrocredits: await getBalance({ meterId, tenantId }),
  });
});
