/**
 * v0/tenant/credit-grant/routes.ts -- HTTP for /v0/tenant/:tenantId/credit-grant:
 * request validation and wiring. Business logic lives in service.ts.
 *
 * The wire speaks fractional credits; the service speaks microcredits.
 * Handlers convert at the boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { MeterBalanceUnavailableError } from "../../../cache/meter/index.ts";
import { serviceUnavailableResponse } from "../../../lib/http.ts";
import {
  creditsPositive,
  creditsToMicrocredits,
  microcreditsToCredits,
} from "../../../lib/credits.ts";
import {
  type CreditGrant,
  creditGrantSchema,
} from "../../../schemas/credit-grant.ts";
import { createCreditGrant, listCreditGrants } from "./service.ts";

const creditGrantCreateWireSchema = creditGrantSchema
  .omit({ amountMicrocredits: true, creditGrantId: true, grantedAt: true })
  .extend({ amountCredits: creditsPositive });

/** The wire grant: amountCredits in place of amountMicrocredits. */
const creditGrantWireSchema = creditGrantSchema
  .omit({ amountMicrocredits: true })
  .extend({ amountCredits: creditsPositive });
type CreditGrantWire = z.infer<typeof creditGrantWireSchema>;

function creditGrantToCredits({
  grant,
}: {
  grant: CreditGrant;
}): CreditGrantWire {
  const { amountMicrocredits, ...rest } = grant;
  return {
    ...rest,
    amountCredits: microcreditsToCredits({ microcredits: amountMicrocredits }),
  };
}

const createCreditGrantRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tenant > Credit grant"],
  summary: "Create a credit grant",
  request: {
    body: {
      content: { "application/json": { schema: creditGrantCreateWireSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: creditGrantWireSchema } },
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
      content: {
        "application/json": { schema: z.array(creditGrantWireSchema) },
      },
      description: "OK",
    },
  },
});

export const creditGrantApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createCreditGrantRoute, async (c) => {
    const tenantId = c.get("tenantId");
    const { amountCredits, ...rest } = c.req.valid("json");
    try {
      const grant = await createCreditGrant({
        grant: {
          ...rest,
          amountMicrocredits: creditsToMicrocredits({
            credits: amountCredits,
          }),
        },
        tenantId,
      });
      return c.json(creditGrantToCredits({ grant }), 201);
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
    const grants = await listCreditGrants({ tenantId: c.get("tenantId") });
    return c.json(
      grants.map((grant) => creditGrantToCredits({ grant })),
      200,
    );
  });
