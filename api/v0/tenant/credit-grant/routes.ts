/**
 * v0/tenant/credit-grant/routes.ts -- HTTP for /v0/tenant/:tenantId/credit-grant:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { MeterBalanceUnavailableError } from "../../../cache/meter/index.ts";
import { creditGrantSchema } from "../../../schemas/credit-grant.ts";
import { createCreditGrant, listCreditGrants } from "./service.ts";

const creditGrantCreateSchema = creditGrantSchema.omit({
  creditGrantId: true,
  grantedAt: true,
});

export type CreditGrantCreateBody = z.infer<typeof creditGrantCreateSchema>;

export const creditGrantApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", creditGrantCreateSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    try {
      return c.json(await createCreditGrant({ grant: body, tenantId }), 201);
    } catch (error) {
      if (error instanceof MeterBalanceUnavailableError) {
        // The grant is durable in pg with applied_at_micros NULL; the
        // reconciler will apply it. Retrying this request is safe
        // (idempotent marker).
        console.error("meter balance unavailable for credit grant", {
          error,
          meterId: error.meterId,
          tenantId: error.tenantId,
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
  })
  .get("/", async (c) => {
    return c.json(await listCreditGrants({ tenantId: c.get("tenantId") }));
  });
