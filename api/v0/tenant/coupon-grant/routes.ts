/**
 * v0/tenant/coupon-grant/routes.ts -- HTTP for /v0/tenant/:tenantId/coupon-grant:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
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

export const couponGrantApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", couponGrantCreateSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const created = await createCouponGrant({ grant: body, tenantId });
    return c.json(created, 201);
  })
  .get("/", async (c) => {
    return c.json(await listCouponGrants({ tenantId: c.get("tenantId") }));
  });
