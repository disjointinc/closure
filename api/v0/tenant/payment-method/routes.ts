/**
 * v0/tenant/payment-method/routes.ts -- HTTP for /v0/tenant/:tenantId/payment-method:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { paymentMethodSchema } from "../../../schemas/payment-method.ts";
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  setDefaultPaymentMethod,
} from "./service.ts";

/** The tenant is the one in the path. */
const paymentMethodCreateSchema = paymentMethodSchema.omit({
  createdAt: true,
  deletedAt: true,
  isDefault: true,
  paymentMethodId: true,
  tenantId: true,
});

export type PaymentMethodCreateBody = z.infer<typeof paymentMethodCreateSchema>;

export const paymentMethodApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", paymentMethodCreateSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    return c.json(
      await createPaymentMethod({ paymentMethod: body, tenantId }),
      201,
    );
  })
  .get("/", async (c) => {
    return c.json(await listPaymentMethods({ tenantId: c.get("tenantId") }));
  })
  .post("/:paymentMethodId/default", async (c) => {
    const paymentMethod = await setDefaultPaymentMethod({
      paymentMethodId: c.req.param("paymentMethodId"),
      tenantId: c.get("tenantId"),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod);
  })
  .delete("/:paymentMethodId", async (c) => {
    const paymentMethod = await deletePaymentMethod({
      paymentMethodId: c.req.param("paymentMethodId"),
      tenantId: c.get("tenantId"),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod);
  });
