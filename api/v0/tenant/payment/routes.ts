/**
 * v0/tenant/payment/routes.ts -- HTTP for /v0/tenant/:id/payment: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../../schemas/common.ts";
import { paymentSchema } from "../../../schemas/payment.ts";
import {
  createPayment,
  getPayment,
  listPayments,
  patchPayment,
} from "./service.ts";

const paymentPatchSchema = z
  .object({
    startedProcessingAt: epochMs.nullable(),
    succeededAt: epochMs.nullable(),
    failedAt: epochMs.nullable(),
  })
  .partial();

export type PaymentPatchBody = z.infer<typeof paymentPatchSchema>;

export const paymentApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", paymentSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createPayment({ payment: body, tenantId: c.get("tenantId") }),
      201,
    );
  })
  .get("/", async (c) => {
    return c.json(await listPayments({ tenantId: c.get("tenantId") }));
  })
  .get("/:payment_id", async (c) => {
    const payment = await getPayment({ uniqueId: c.req.param("payment_id") });
    if (!payment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(payment);
  })
  .patch("/:payment_id", zValidator("json", paymentPatchSchema), async (c) => {
    const payment = await patchPayment({
      patch: c.req.valid("json"),
      paymentId: c.req.param("payment_id"),
    });
    if (!payment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(payment);
  });
