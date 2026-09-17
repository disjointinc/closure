/**
 * v0/tenant/credit-grant/routes.ts -- HTTP for /v0/tenant/:tenantId/credit-grant:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { MeterBalanceUnavailableError } from "../../../cache/meter/index.ts";
import { serviceUnavailableResponse } from "../../../lib/http.ts";
import { creditGrantSchema } from "../../../schemas/credit-grant.ts";
import { createCreditGrant, listCreditGrants } from "./service.ts";

const creditGrantCreateSchema = creditGrantSchema.omit({
  creditGrantId: true,
  grantedAt: true,
});

export type CreditGrantCreateBody = z.infer<typeof creditGrantCreateSchema>;

const createCreditGrantRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tenant > Credit grant"],
  summary: "Create a credit grant",
  request: {
    body: {
      content: { "application/json": { schema: creditGrantCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: creditGrantSchema } },
      description: "Created",
    },
    503: serviceUnavailableResponse,
  },
});

const listCreditGrantsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tenant > Credit grant"],
  summary: "List credit grants",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(creditGrantSchema) } },
      description: "OK",
    },
  },
});

export const creditGrantApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createCreditGrantRoute, async (c) => {
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
  .openapi(listCreditGrantsRoute, async (c) => {
    return c.json(await listCreditGrants({ tenantId: c.get("tenantId") }), 200);
  });
