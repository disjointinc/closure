/**
 * v0/payment-methods/routes.ts -- HTTP for /v0/tenants/:id/payment-methods:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { paymentMethodSchema } from "../../schemas/payment-method.ts";
import { tenantParam } from "../helpers.ts";
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  setDefaultPaymentMethod,
} from "./service.ts";

export const paymentMethodsApp = new Hono()
  .post("/", zValidator("json", paymentMethodSchema), async (c) => {
    const tenantId = tenantParam(c);
    const body = c.req.valid("json");
    await createPaymentMethod({ paymentMethod: body, tenantId });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listPaymentMethods({ tenantId: tenantParam(c) }));
  })
  .post("/:pmid/default", async (c) => {
    const paymentMethod = await setDefaultPaymentMethod({
      paymentMethodId: c.req.param("pmid"),
      tenantId: tenantParam(c),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod);
  })
  .delete("/:pmid", async (c) => {
    const paymentMethod = await deletePaymentMethod({
      paymentMethodId: c.req.param("pmid"),
      tenantId: tenantParam(c),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod);
  });
