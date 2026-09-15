/**
 * v0/tenant/coupon-grant/routes.ts -- HTTP for /v0/tenant/:tenantId/coupon-grant:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { couponGrantSchema } from "../../../schemas/coupon-grant.ts";
import { createCouponGrant, listCouponGrants } from "./service.ts";

/** The tenant is the granting tenant in the path. */
const couponGrantCreateSchema = couponGrantSchema.omit({
  couponGrantId: true,
  fromTenantId: true,
  grantedAt: true,
  usedAt: true,
});

export type CouponGrantCreateBody = z.infer<typeof couponGrantCreateSchema>;

const createCouponGrantRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/coupon-grant"],
  summary: "Create a coupon grant",
  request: {
    body: {
      content: { "application/json": { schema: couponGrantCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: couponGrantSchema } },
      description: "Created",
    },
  },
});

const listCouponGrantsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/coupon-grant"],
  summary: "List coupon grants",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(couponGrantSchema) } },
      description: "OK",
    },
  },
});

export const couponGrantApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createCouponGrantRoute, async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const created = await createCouponGrant({ grant: body, tenantId });
    return c.json(created, 201);
  })
  .openapi(listCouponGrantsRoute, async (c) => {
    return c.json(await listCouponGrants({ tenantId: c.get("tenantId") }), 200);
  });
