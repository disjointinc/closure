/**
 * v0/tenant/coupon-receipt/routes.ts -- HTTP for
 * /v0/tenant/:id/coupon-receipt: request validation and wiring. Business
 * logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../../schemas/common.ts";
import {
  couponIdSchema,
  couponReceiptIdSchema,
  teamMemberIdSchema,
} from "../../../schemas/ids.ts";
import {
  createCouponReceipt,
  listCouponReceipts,
  useCouponReceipt,
} from "./service.ts";

const receiptCreateSchema = z.object({
  unique_id: couponReceiptIdSchema,
  coupon: couponIdSchema,
  on: epochMs,
  /** The team member granting the coupon. */
  by: teamMemberIdSchema,
  reason: z.string().nullable(),
});

export type ReceiptCreateBody = z.infer<typeof receiptCreateSchema>;

export const couponReceiptApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", receiptCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createCouponReceipt({
        receipt: body,
        tenantId: c.get("tenantId"),
      }),
      201,
    );
  })
  .get("/", async (c) => {
    return c.json(await listCouponReceipts({ tenantId: c.get("tenantId") }));
  })
  .post(
    "/:receipt_id/use",
    zValidator("json", z.object({ used_at: epochMs })),
    async (c) => {
      const receipt = await useCouponReceipt({
        receiptId: c.req.param("receipt_id"),
        usedAt: c.req.valid("json").used_at,
      });
      if (!receipt) {
        return c.json({ error: "not found or already used" }, 409);
      }
      return c.json(receipt);
    },
  );
