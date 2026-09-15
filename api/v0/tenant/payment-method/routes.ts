/**
 * v0/tenant/payment-method/routes.ts -- HTTP for /v0/tenant/:tenantId/payment-method:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../../lib/http.ts";
import { paymentMethodIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
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

const createPaymentMethodRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/payment-method"],
  summary: "Create a payment method",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: paymentMethodCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: paymentMethodSchema } },
      description: "Created",
    },
  },
});

const listPaymentMethodsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/payment-method"],
  summary: "List payment methods",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(paymentMethodSchema) } },
      description: "OK",
    },
  },
});

const setDefaultPaymentMethodRoute = createRoute({
  method: "post",
  path: "/{paymentMethodId}/default",
  tags: ["tenant/payment-method"],
  summary: "Set a default payment method",
  request: {
    params: z.object({
      paymentMethodId: paymentMethodIdSchema,
      tenantId: tenantIdSchema,
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: paymentMethodSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deletePaymentMethodRoute = createRoute({
  method: "delete",
  path: "/{paymentMethodId}",
  tags: ["tenant/payment-method"],
  summary: "Delete a payment method",
  request: {
    params: z.object({
      paymentMethodId: paymentMethodIdSchema,
      tenantId: tenantIdSchema,
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: paymentMethodSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const paymentMethodApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createPaymentMethodRoute, async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    return c.json(
      await createPaymentMethod({ paymentMethod: body, tenantId }),
      201,
    );
  })
  .openapi(listPaymentMethodsRoute, async (c) => {
    return c.json(
      await listPaymentMethods({ tenantId: c.get("tenantId") }),
      200,
    );
  })
  .openapi(setDefaultPaymentMethodRoute, async (c) => {
    const paymentMethod = await setDefaultPaymentMethod({
      paymentMethodId: c.req.param("paymentMethodId"),
      tenantId: c.get("tenantId"),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod, 200);
  })
  .openapi(deletePaymentMethodRoute, async (c) => {
    const paymentMethod = await deletePaymentMethod({
      paymentMethodId: c.req.param("paymentMethodId"),
      tenantId: c.get("tenantId"),
    });
    if (!paymentMethod) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(paymentMethod, 200);
  });
