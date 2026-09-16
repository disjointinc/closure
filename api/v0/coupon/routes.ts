/**
 * v0/coupon/routes.ts -- HTTP for /v0/coupon: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import {
  featureSetTo,
  microcredits,
  resetSchedule,
} from "../../schemas/common.ts";
import { checkCoupon, couponSchema } from "../../schemas/coupon.ts";
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
      couponTemplateId: z.null(),
      ...couponDefinitionFields,
    })
    .superRefine(checkCoupon),
  // From a template: the definition is copied from the template at creation,
  // so definitional fields are not accepted. (Strict: otherwise zod would
  // silently strip them.)
  z
    .object({
      couponTemplateId: couponTemplateIdSchema,
      reciprocalBenefitCouponId: couponIdSchema.nullable(),
    })
    .strict(),
]);

export type CouponCreateBody = z.infer<typeof couponCreateSchema>;

/** The coupon shape the call surface reads: awards carry full values. */
const couponApiSchema = z.object({
  // couponSchema is refined, so rebuild its shape rather than .extend() it.
  ...couponSchema.shape,
  defaultAward: awardApiSchema.nullable(),
  featuresGranted: couponDefinitionFields.featuresGranted,
  creditsGranted: couponDefinitionFields.creditsGranted,
});

const createCouponRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Coupon"],
  summary: "Create a coupon",
  request: {
    body: {
      content: { "application/json": { schema: couponCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: couponApiSchema } },
      description: "Created",
    },
    404: notFoundResponse,
  },
});

const listCouponsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Coupon"],
  summary: "List coupons",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(couponApiSchema) } },
      description: "OK",
    },
  },
});

const getCouponRoute = createRoute({
  method: "get",
  path: "/{couponId}",
  tags: ["Coupon"],
  summary: "Get a coupon",
  request: { params: z.object({ couponId: couponIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: couponApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deleteCouponRoute = createRoute({
  method: "delete",
  path: "/{couponId}",
  tags: ["Coupon"],
  summary: "Delete a coupon",
  request: { params: z.object({ couponId: couponIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: couponApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const couponApp = new OpenAPIHono()
  .openapi(createCouponRoute, async (c) => {
    const body = c.req.valid("json");
    const coupon = await createCoupon({ coupon: body });
    if (!coupon) {
      return c.json({ error: "template not found" }, 404);
    }
    return c.json(coupon, 201);
  })
  .openapi(listCouponsRoute, async (c) => {
    return c.json(await listCoupons(), 200);
  })
  .openapi(getCouponRoute, async (c) => {
    const coupon = await getCoupon({ couponId: c.req.param("couponId") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon, 200);
  })
  .openapi(deleteCouponRoute, async (c) => {
    const coupon = await deleteCoupon({ couponId: c.req.param("couponId") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(coupon, 200);
  });
