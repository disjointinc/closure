/**
 * v0/meter-balances/routes.ts -- HTTP for /v0/tenants/:id/meter-balances.
 * Business logic lives in service.ts.
 */
import { Hono } from "hono";
import { tenantParam } from "../helpers.ts";
import { getBalance } from "./service.ts";

export const meterBalancesApp = new Hono().get("/:meterId", async (c) => {
  const tenantId = tenantParam(c);
  const meterId = c.req.param("meterId");
  return c.json({
    tenant: tenantId,
    meter: meterId,
    balance_microcredits: await getBalance({ meterId, tenantId }),
  });
});
