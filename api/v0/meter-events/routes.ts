/**
 * v0/meter-events/routes.ts -- HTTP for /v0/tenants/:id/meter-events:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { MeterBalanceUnavailableError } from "../../cache/metering.ts";
import { meterEventSchema } from "../../schemas/meter-event.ts";
import { listMeterEvents, recordEvent } from "./service.ts";

const meterEventCreateSchema = meterEventSchema.omit({
  tenant: true,
  status: true,
});

export type MeterEventCreateBody = z.infer<typeof meterEventCreateSchema>;

export const meterEventsApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", meterEventCreateSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    try {
      const { balanceMicrocredits, status } = await recordEvent({
        event: body,
        tenantId,
      });
      return c.json(
        {
          ...body,
          tenant: tenantId,
          status,
          balance_microcredits: balanceMicrocredits,
        },
        201,
      );
    } catch (error) {
      if (error instanceof MeterBalanceUnavailableError) {
        // Fail closed, explicitly: the balance key is being rebuilt from pg
        // (or can't be). Nothing was charged; retry shortly.
        console.error("meter balance unavailable for ingest", {
          error,
          meter: error.meter,
          tenant: error.tenant,
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
