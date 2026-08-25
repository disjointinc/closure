/**
 * v0/tenant/meter-balance/routes.ts -- HTTP for /v0/tenant/:id/meter-balance.
 * Business logic lives in service.ts.
 */
import { Hono } from "hono";
import { getBalance } from "./service.ts";

export const meterBalanceApp = new Hono<{
  Variables: { tenantId: string };
}>().get("/:meter_id", async (c) => {
  const tenantId = c.get("tenantId");
  const meterId = c.req.param("meter_id");
  return c.json({
    tenant: tenantId,
    meter: meterId,
    balance_microcredits: await getBalance({ meterId, tenantId }),
  });
});
