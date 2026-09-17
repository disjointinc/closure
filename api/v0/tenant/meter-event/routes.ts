/**
 * v0/tenant/meter-event/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-event:
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
  credits,
  creditsToMicrocredits,
  microcreditsToCredits,
} from "../../../lib/credits.ts";
import { tenantIdSchema } from "../../../schemas/ids.ts";
import { meterEventSchema } from "../../../schemas/meter-event.ts";
import { recordEvent } from "./service.ts";

const meterEventCreateWireSchema = meterEventSchema
  .omit({
    amountMicrocredits: true,
    createdAt: true,
    meterEventId: true,
    status: true,
    tenantId: true,
  })
  .extend({
    /**
     * Signed: positive charges credits, negative refunds them. Rounded to
     * the nearest millionth; values that round to zero are meaningless.
     */
    amountCredits: credits.refine(
      (value) => creditsToMicrocredits({ credits: value }) !== 0,
      "amountCredits must be nonzero",
    ),
  });

/* The ingest outcome joined onto the recorded event, credit-denominated:
 * the persisted status and the post-decision balance (null on a redelivery
 * whose balance key has since been lost). */
const meterEventWireApiSchema = meterEventSchema
  .omit({ amountMicrocredits: true })
  .extend({
    amountCredits: credits,
    balanceCredits: credits.nullable(),
  });

const recordMeterEventRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tenant > Meter event"],
  summary: "Record a meter event",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: meterEventCreateWireSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: meterEventWireApiSchema } },
      description: "Created",
    },
    503: serviceUnavailableResponse,
  },
});

export const meterEventApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>().openapi(recordMeterEventRoute, async (c) => {
  const tenantId = c.get("tenantId");
  const { amountCredits, ...rest } = c.req.valid("json");
  try {
    const { balanceMicrocredits, event, status } = await recordEvent({
      event: {
        ...rest,
        amountMicrocredits: creditsToMicrocredits({ credits: amountCredits }),
      },
      tenantId,
    });
    const { amountMicrocredits, ...eventRest } = event;
    return c.json(
      {
        ...eventRest,
        amountCredits: microcreditsToCredits({
          microcredits: amountMicrocredits,
        }),
        status,
        balanceCredits:
          balanceMicrocredits === null
            ? null
            : microcreditsToCredits({ microcredits: balanceMicrocredits }),
      },
      201,
    );
  } catch (error) {
    if (error instanceof MeterBalanceUnavailableError) {
      // Fail closed, explicitly: the balance key is being rebuilt from pg
      // (or can't be). Nothing was charged; retry shortly.
      console.error("meter balance unavailable for ingest", {
        error,
        meterId: error.meterId,
        tenantId: error.tenantId,
      });
      return c.json(
        { error: "meter balance temporarily unavailable; retry shortly" },
        503,
      );
    }
    throw error;
  }
});
