/**
 * v0/tenant/refund/routes.ts -- HTTP for /v0/tenant/:tenantId/refund: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../../lib/http.ts";
import { refundIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import { refundSchema } from "../../../schemas/refund.ts";
import { LoanServicingError } from "../loan/servicing.ts";
import {
  createRefund,
  getRefund,
  listRefunds,
  patchRefund,
} from "./service.ts";

// The tenant is the one in the path; the server mints the refund id and
// stamps createdAt, so the body carries neither.
const refundCreateSchema = refundSchema.omit({
  refundId: true,
  tenantId: true,
  createdAt: true,
  startedProcessingAt: true,
  succeededAt: true,
  failedAt: true,
  loanPrincipalAmount: true,
  loanInterestAmount: true,
});

const refundPatchSchema = z.object({
  event: z.enum(["started_processing", "succeeded", "failed"]),
});

export type RefundCreateBody = z.infer<typeof refundCreateSchema>;
export type RefundPatchBody = z.infer<typeof refundPatchSchema>;

const createRefundRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tenant > Refund"],
  summary: "Create a refund",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: refundCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: refundSchema } },
      description: "Created",
    },
    404: notFoundResponse,
  },
});

const listRefundsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tenant > Refund"],
  summary: "List refunds",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(refundSchema) } },
      description: "OK",
    },
  },
});

const getRefundRoute = createRoute({
  method: "get",
  path: "/{refundId}",
  tags: ["Tenant > Refund"],
  summary: "Get a refund",
  request: {
    params: z.object({ refundId: refundIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: refundSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const patchRefundRoute = createRoute({
  method: "patch",
  path: "/{refundId}",
  tags: ["Tenant > Refund"],
  summary: "Patch a refund",
  request: {
    params: z.object({ refundId: refundIdSchema, tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: refundPatchSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: refundSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const refundApp = new OpenAPIHono<{ Variables: { tenantId: string } }>()
  .onError((error, c) => {
    console.error("refund request failed", error);
    if (error instanceof LoanServicingError) {
      return c.json({ code: error.code, error: error.message }, error.status);
    }
    return c.json({ error: "internal server error" }, 500);
  })
  .openapi(createRefundRoute, async (c) => {
    const body = c.req.valid("json");
    const refund = await createRefund({
      refund: body,
      tenantId: c.get("tenantId"),
    });
    if (!refund) {
      return c.json({ error: "payment not found" }, 404);
    }
    return c.json(refund, 201);
  })
  .openapi(listRefundsRoute, async (c) => {
    return c.json(await listRefunds({ tenantId: c.get("tenantId") }), 200);
  })
  .openapi(getRefundRoute, async (c) => {
    const refund = await getRefund({
      refundId: c.req.param("refundId"),
      tenantId: c.get("tenantId"),
    });
    if (!refund) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(refund, 200);
  })
  .openapi(patchRefundRoute, async (c) => {
    const refund = await patchRefund({
      patch: c.req.valid("json"),
      refundId: c.req.param("refundId"),
      tenantId: c.get("tenantId"),
    });
    if (!refund) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(refund, 200);
  });
