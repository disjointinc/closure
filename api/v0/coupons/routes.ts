/**
 * v0/coupons/routes.ts -- HTTP for /v0/coupons: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  featureSetTo,
  microcredits,
  resetSchedule,
} from "../../schemas/common.ts";
import { checkCoupon, couponSchema } from "../../schemas/coupon.ts";
import { featureIdSchema, meterIdSchema } from "../../schemas/ids.ts";
import { awardInputSchema } from "../helpers.ts";
import {
  createCoupon,
  deprecateCoupon,
  getCoupon,
  listCoupons,
} from "./service.ts";

const couponCreateSchema = z
  .object({
    ...couponSchema.shape,
    default_award: awardInputSchema.nullable(),
    features_granted: z
      .array(
        z.object({
          feature: featureIdSchema,
          value: featureSetTo,
          award: awardInputSchema,
        }),
      )
      .nullable(),
    credits_granted: z
      .array(
        z.object({
          meter: meterIdSchema,
          amount: microcredits.positive(),
          expiration: resetSchedule.nullable(),
          rollovers: z.number().int().nonnegative().nullable(),
          award: awardInputSchema,
        }),
      )
      .nullable(),
  })
  .superRefine(checkCoupon);

export type CouponCreateBody = z.infer<typeof couponCreateSchema>;

export const couponsApp = new Hono()
  .post("/", zValidator("json", couponCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createCoupon({ coupon: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listCoupons());
  })
  .get("/:id", async (c) => {
    const coupon = await getCoupon({ uniqueId: c.req.param("id") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon);
  })
  .delete("/:id", async (c) => {
    const coupon = await deprecateCoupon({ uniqueId: c.req.param("id") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon);
  });
