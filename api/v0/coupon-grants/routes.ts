/**
 * v0/coupon-grants/routes.ts -- HTTP for /v0/tenants/:id/coupon-grants:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { couponGrantSchema } from "../../schemas/coupon-grant.ts";
import { createCouponGrant, listCouponGrants } from "./service.ts";

export const couponGrantsApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", couponGrantSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const { receiptId } = await createCouponGrant({ grant: body, tenantId });
    return c.json({ grant: body, receipt: receiptId }, 201);
  })
  .get("/", async (c) => {
    return c.json(await listCouponGrants({ tenantId: c.get("tenantId") }));
  });
