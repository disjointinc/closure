/**
 * v0/meter-balances/routes.ts -- HTTP for /v0/tenants/:id/meter-balances.
 * Business logic lives in service.ts.
 */
import { Hono } from "hono";
import { getBalance } from "./service.ts";

export const meterBalancesApp = new Hono<{
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
