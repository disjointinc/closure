/**
 * v0/tenant/meter-event/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-event:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { MeterBalanceUnavailableError } from "../../../cache/meter/index.ts";
import { serviceUnavailableResponse } from "../../../lib/http.ts";
import { microcredits } from "../../../schemas/common.ts";
import { tenantIdSchema } from "../../../schemas/ids.ts";
import { meterEventSchema } from "../../../schemas/meter-event.ts";
import { recordEvent } from "./service.ts";

const meterEventCreateSchema = meterEventSchema.omit({
  createdAt: true,
  meterEventId: true,
  status: true,
  tenantId: true,
});

/* The ingest outcome joined onto the recorded event: the persisted status
 * and the post-decision balance (null on a redelivery whose balance key has
 * since been lost). */
const meterEventApiSchema = meterEventSchema.extend({
  balanceMicrocredits: microcredits.nullable(),
});

export type MeterEventCreateBody = z.infer<typeof meterEventCreateSchema>;

const recordMeterEventRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tenant > Meter event"],
  summary: "Record a meter event",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: meterEventCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: meterEventApiSchema } },
      description: "Created",
    },
    503: serviceUnavailableResponse,
  },
});

export const meterEventApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>().openapi(recordMeterEventRoute, async (c) => {
  const tenantId = c.get("tenantId");
  const body = c.req.valid("json");
  try {
    const { balanceMicrocredits, event, status } = await recordEvent({
      event: body,
      tenantId,
    });
    return c.json(
      {
        ...event,
        status,
        balanceMicrocredits,
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
