/**
 * v0/credit-grants/routes.ts -- HTTP for /v0/tenants/:id/credit-grants:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { MeterBalanceUnavailableError } from "../../cache/metering.ts";
import { creditGrantSchema } from "../../schemas/credit-grant.ts";
import { tenantParam } from "../helpers.ts";
import { createCreditGrant, listCreditGrants } from "./service.ts";

export const creditGrantsApp = new Hono()
  .post("/", zValidator("json", creditGrantSchema), async (c) => {
    const tenantId = tenantParam(c);
    const body = c.req.valid("json");
    try {
      await createCreditGrant({ grant: body, tenantId });
    } catch (error) {
      if (error instanceof MeterBalanceUnavailableError) {
        // The grant is durable in pg with applied_at NULL; the reconciler
        // will apply it. Retrying this request is safe (idempotent marker).
        console.error("meter balance unavailable for credit grant", {
          error,
          meter: error.meter,
          tenant: error.tenant,
        });
        return c.json(
          {
            error:
              "grant recorded but the balance is temporarily unavailable; it will be applied automatically",
          },
          503,
        );
      }
      throw error;
    }
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listCreditGrants({ tenantId: tenantParam(c) }));
  });
