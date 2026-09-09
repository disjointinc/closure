/**
 * v0/tenant/meter-event/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-event:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { MeterBalanceUnavailableError } from "../../../cache/meter/index.ts";
import { meterEventSchema } from "../../../schemas/meter-event.ts";
import { listMeterEvents, recordEvent } from "./service.ts";

const meterEventCreateSchema = meterEventSchema.omit({
  createdAt: true,
  meterEventId: true,
  status: true,
  tenantId: true,
});

export type MeterEventCreateBody = z.infer<typeof meterEventCreateSchema>;

export const meterEventApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", meterEventCreateSchema), async (c) => {
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
  })
  .get("/", async (c) => {
    const limit = Math.min(Number(c.req.query("limit")) || 100, 1000);
    return c.json(
      await listMeterEvents({ limit, tenantId: c.get("tenantId") }),
    );
  });
