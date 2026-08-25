/**
 * v0/coupon/routes.ts -- HTTP for /v0/coupon: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  epochMs,
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
import { awardInputSchema } from "../award/service.ts";
import {
  createCoupon,
  deleteCoupon,
  getCoupon,
  listCoupons,
} from "./service.ts";

const couponDefinitionFields = {
  grantable_by_tenants: z.boolean(),
  /** Only settable when grantable_by_tenants. Null means no limit. */
  limit_per_granting_tenant: z.number().int().positive().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
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
  /** Only settable when grantable_by_tenants. */
  reciprocal_benefit_coupon: couponIdSchema.nullable(),
};

const couponCreateSchema = z.union([
  // Inline definition.
  z
    .object({
      unique_id: couponIdSchema,
      created_at: epochMs,
      deleted_at: epochMs.nullable(),
      template: z.null().optional(),
      ...couponDefinitionFields,
    })
    .superRefine(checkCoupon),
  // From a template: the definition is copied from the template at creation,
  // so definitional fields are not accepted. (Strict: otherwise zod would
  // silently strip them.)
  z
    .object({
      unique_id: couponIdSchema,
      created_at: epochMs,
      deleted_at: epochMs.nullable(),
      template: couponTemplateIdSchema,
      reciprocal_benefit_coupon: couponIdSchema.nullable(),
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
  .get("/:id", async (c) => {
    const coupon = await getCoupon({ uniqueId: c.req.param("id") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon);
  })
  .delete("/:id", async (c) => {
    const coupon = await deleteCoupon({ uniqueId: c.req.param("id") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon);
  });
