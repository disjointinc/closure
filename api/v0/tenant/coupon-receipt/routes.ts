/**
 * v0/tenant/coupon-receipt/routes.ts -- HTTP for
 * /v0/tenant/:tenantId/coupon-receipt: request validation and wiring. Business
 * logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { conflictResponse } from "../../../lib/http.ts";
import { epochMs } from "../../../schemas/common.ts";
import {
  couponIdSchema,
  couponReceiptIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "../../../schemas/ids.ts";
import {
  createCouponReceipt,
  listCouponReceipts,
  useCouponReceipt,
} from "./service.ts";

const receiptCreateSchema = z.object({
  couponId: couponIdSchema,
  /** The team member granting the coupon. */
  grantorId: teamMemberIdSchema,
  reason: z.string().nullable(),
});

export type ReceiptCreateBody = z.infer<typeof receiptCreateSchema>;

/* rowToReceipt (service.ts) doesn't narrow grantorType/grantorId by variant,
 * so the wire schema is the widened shape it actually returns -- the
 * discriminated couponReceiptSchema would not typecheck against it. */
const couponReceiptApiSchema = z.object({
  couponReceiptId: couponReceiptIdSchema,
  couponId: couponIdSchema,
  receivedAt: epochMs,
  usedAt: epochMs.nullable(),
  reason: z.string().nullable(),
  grantorType: z.string(),
  grantorId: z.string().nullable(),
});

const createCouponReceiptRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/coupon-receipt"],
  summary: "Create a coupon receipt",
  request: {
    body: {
      content: { "application/json": { schema: receiptCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: couponReceiptApiSchema } },
      description: "Created",
    },
  },
});

const listCouponReceiptsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/coupon-receipt"],
  summary: "List coupon receipts",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.array(couponReceiptApiSchema) },
      },
      description: "OK",
    },
  },
});

const useCouponReceiptRoute = createRoute({
  method: "post",
  path: "/{couponReceiptId}/use",
  tags: ["tenant/coupon-receipt"],
  summary: "Use a coupon receipt",
  request: {
    params: z.object({
      couponReceiptId: couponReceiptIdSchema,
      tenantId: tenantIdSchema,
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: couponReceiptApiSchema } },
      description: "OK",
    },
    409: conflictResponse,
  },
});

export const couponReceiptApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createCouponReceiptRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createCouponReceipt({
        receipt: body,
        tenantId: c.get("tenantId"),
      }),
      201,
    );
  })
  .openapi(listCouponReceiptsRoute, async (c) => {
    return c.json(
      await listCouponReceipts({ tenantId: c.get("tenantId") }),
      200,
    );
  })
  .openapi(useCouponReceiptRoute, async (c) => {
    const receipt = await useCouponReceipt({
      couponReceiptId: c.req.param("couponReceiptId"),
    });
    if (!receipt) {
      return c.json({ error: "not found or already used" }, 409);
    }
    return c.json(receipt, 200);
  });
