/**
 * v0/payments/routes.ts -- HTTP for /v0/tenants/:id/payments: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../schemas/common.ts";
import { paymentSchema } from "../../schemas/payment.ts";
import { tenantParam } from "../helpers.ts";
import {
  createPayment,
  getPayment,
  listPayments,
  patchPayment,
} from "./service.ts";

const paymentPatchSchema = z
  .object({
    started_processing_at: epochMs.nullable(),
    succeeded_at: epochMs.nullable(),
    failed_at: epochMs.nullable(),
  })
  .partial();

export type PaymentPatchBody = z.infer<typeof paymentPatchSchema>;

export const paymentsApp = new Hono()
  .post("/", zValidator("json", paymentSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createPayment({ payment: body, tenantId: tenantParam(c) }),
      201,
    );
  })
  .get("/", async (c) => {
    return c.json(await listPayments({ tenantId: tenantParam(c) }));
  })
  .get("/:pid", async (c) => {
    const payment = await getPayment({ uniqueId: c.req.param("pid") });
    if (!payment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(payment);
  })
  .patch("/:pid", zValidator("json", paymentPatchSchema), async (c) => {
    const payment = await patchPayment({
      patch: c.req.valid("json"),
      paymentId: c.req.param("pid"),
    });
    if (!payment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(payment);
  });
