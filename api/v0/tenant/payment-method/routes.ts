/**
 * v0/tenant/payment-method/routes.ts -- HTTP for /v0/tenant/:id/payment-method:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { paymentMethodSchema } from "../../../schemas/payment-method.ts";
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  setDefaultPaymentMethod,
} from "./service.ts";

export const paymentMethodApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", paymentMethodSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    await createPaymentMethod({ paymentMethod: body, tenantId });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listPaymentMethods({ tenantId: c.get("tenantId") }));
  })
  .post("/:payment_method_id/default", async (c) => {
    const paymentMethod = await setDefaultPaymentMethod({
      paymentMethodId: c.req.param("payment_method_id"),
      tenantId: c.get("tenantId"),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod);
  })
  .delete("/:payment_method_id", async (c) => {
    const paymentMethod = await deletePaymentMethod({
      paymentMethodId: c.req.param("payment_method_id"),
      tenantId: c.get("tenantId"),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod);
  });
