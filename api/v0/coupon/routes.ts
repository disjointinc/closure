/**
 * v0/coupon/routes.ts -- HTTP for /v0/coupon: request validation and
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
import { checkCoupon } from "../../schemas/coupon.ts";
import {
  couponIdSchema,
  couponTemplateIdSchema,
  featureIdSchema,
  meterIdSchema,
} from "../../schemas/ids.ts";
import { awardApiSchema } from "../award/service.ts";
import {
  createCoupon,
  deleteCoupon,
  getCoupon,
  listCoupons,
} from "./service.ts";

const couponDefinitionFields = {
  grantableByTenants: z.boolean(),
  /** Only settable when grantableByTenants. Null means no limit. */
  limitPerGrantingTenant: z.number().int().positive().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  defaultAward: awardApiSchema.nullable(),
  featuresGranted: z
    .array(
      z.object({
        featureId: featureIdSchema,
        setTo: featureSetTo,
        award: awardApiSchema,
      }),
    )
    .nullable(),
  creditsGranted: z
    .array(
      z.object({
        meterId: meterIdSchema,
        amountMicrocredits: microcredits.positive(),
        expiration: resetSchedule.nullable(),
        rollovers: z.number().int().nonnegative().nullable(),
        award: awardApiSchema,
      }),
    )
    .nullable(),
  /** Only settable when grantableByTenants. */
  reciprocalBenefitCouponId: couponIdSchema.nullable(),
};

const couponCreateSchema = z.union([
  // Inline definition.
  z
    .object({
      templateId: z.null(),
      ...couponDefinitionFields,
    })
    .superRefine(checkCoupon),
  // From a template: the definition is copied from the template at creation,
  // so definitional fields are not accepted. (Strict: otherwise zod would
  // silently strip them.)
  z
    .object({
      templateId: couponTemplateIdSchema,
      reciprocalBenefitCouponId: couponIdSchema.nullable(),
    })
    .strict(),
]);

export type CouponCreateBody = z.infer<typeof couponCreateSchema>;

export const couponApp = new Hono()
  .post("/", zValidator("json", couponCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const coupon = await createCoupon({ coupon: body });
    if (!coupon) {
      return c.json({ error: "template not found" }, 404);
    }
    return c.json(coupon, 201);
  })
  .get("/", async (c) => {
    return c.json(await listCoupons());
  })
  .get("/:couponId", async (c) => {
    const coupon = await getCoupon({ couponId: c.req.param("couponId") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon);
  })
  .delete("/:couponId", async (c) => {
    const coupon = await deleteCoupon({ couponId: c.req.param("couponId") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon);
  });
