/**
 * v0/tenant/payment/routes.ts -- HTTP for /v0/tenant/:tenantId/payment: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../../lib/http.ts";
import { paymentIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import { paymentLoanSchema, paymentSchema } from "../../../schemas/payment.ts";
import { LoanServicingError } from "../loan/servicing.ts";
import {
  createPayment,
  getPayment,
  listPayments,
  patchPayment,
} from "./service.ts";

// The server mints the id and stamps createdAt; lifecycle timestamps
// start null and move via PATCH events. Loan allocation starts null.
const paymentCreateSchema = paymentSchema
  .omit({
    paymentId: true,
    createdAt: true,
    startedProcessingAt: true,
    succeededAt: true,
    failedAt: true,
  })
  .extend({
    loan: paymentLoanSchema
      .omit({ principalAmount: true, interestAmount: true })
      .nullable()
      .default(null),
  });

const paymentPatchSchema = z.object({
  event: z.enum(["started_processing", "succeeded", "failed"]),
});

export type PaymentCreateBody = z.infer<typeof paymentCreateSchema>;
export type PaymentPatchBody = z.infer<typeof paymentPatchSchema>;

const createPaymentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/payment"],
  summary: "Create a payment",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: paymentCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: paymentSchema } },
      description: "Created",
    },
    404: notFoundResponse,
  },
});

const listPaymentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/payment"],
  summary: "List payments",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(paymentSchema) } },
      description: "OK",
    },
  },
});

const getPaymentRoute = createRoute({
  method: "get",
  path: "/{paymentId}",
  tags: ["tenant/payment"],
  summary: "Get a payment",
  request: {
    params: z.object({ paymentId: paymentIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: paymentSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const patchPaymentRoute = createRoute({
  method: "patch",
  path: "/{paymentId}",
  tags: ["tenant/payment"],
  summary: "Patch a payment",
  request: {
    params: z.object({ paymentId: paymentIdSchema, tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: paymentPatchSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: paymentSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const paymentApp = new OpenAPIHono<{ Variables: { tenantId: string } }>()
  .onError((error, c) => {
    console.error("payment request failed", error);
    if (error instanceof LoanServicingError) {
      return c.json({ code: error.code, error: error.message }, error.status);
    }
    return c.json({ error: "internal server error" }, 500);
  })
  .openapi(createPaymentRoute, async (c) => {
    const body = c.req.valid("json");
    const payment = await createPayment({
      payment: body,
      tenantId: c.get("tenantId"),
    });
    if (!payment) {
      return c.json({ error: "loan or invoice not found" }, 404);
    }
    return c.json(payment, 201);
  })
  .openapi(listPaymentsRoute, async (c) => {
    return c.json(await listPayments({ tenantId: c.get("tenantId") }), 200);
  })
  .openapi(getPaymentRoute, async (c) => {
    const payment = await getPayment({
      paymentId: c.req.param("paymentId"),
      tenantId: c.get("tenantId"),
    });
    if (!payment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(payment, 200);
  })
  .openapi(patchPaymentRoute, async (c) => {
    const payment = await patchPayment({
      patch: c.req.valid("json"),
      paymentId: c.req.param("paymentId"),
      tenantId: c.get("tenantId"),
    });
    if (!payment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(payment, 200);
  });
