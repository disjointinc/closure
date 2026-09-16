/**
 * v0/coupon-template/routes.ts -- HTTP for /v0/coupon-template: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import {
  featureSetTo,
  microcredits,
  resetSchedule,
} from "../../schemas/common.ts";
import {
  checkCouponTemplate,
  couponTemplateSchema,
} from "../../schemas/coupon-template.ts";
import {
  couponTemplateIdSchema,
  featureIdSchema,
  meterIdSchema,
} from "../../schemas/ids.ts";
import { awardApiSchema } from "../award/service.ts";
import {
  createCouponTemplate,
  deprecateCouponTemplate,
  getCouponTemplate,
  listCouponTemplates,
} from "./service.ts";

const featuresGrantedApiSchema = z
  .array(
    z.object({
      featureId: featureIdSchema,
      setTo: featureSetTo,
      award: awardApiSchema,
    }),
  )
  .nullable();

const creditsGrantedApiSchema = z
  .array(
    z.object({
      meterId: meterIdSchema,
      amountMicrocredits: microcredits.positive(),
      expiration: resetSchedule.nullable(),
      rollovers: z.number().int().nonnegative().nullable(),
      award: awardApiSchema,
    }),
  )
  .nullable();

/** The template shape the call surface reads: awards carry full values. */
const couponTemplateApiSchema = z.object({
  ...couponTemplateSchema.shape,
  defaultAward: awardApiSchema.nullable(),
  featuresGranted: featuresGrantedApiSchema,
  creditsGranted: creditsGrantedApiSchema,
});

const couponTemplateCreateSchema = z
  .object({
    ...couponTemplateSchema.shape,
    defaultAward: awardApiSchema.nullable(),
    featuresGranted: featuresGrantedApiSchema,
    creditsGranted: creditsGrantedApiSchema,
  })
  .omit({ couponTemplateId: true, createdAt: true, deprecatedAt: true })
  .superRefine(checkCouponTemplate);

export type CouponTemplateCreateBody = z.infer<
  typeof couponTemplateCreateSchema
>;

const createCouponTemplateRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Coupon template"],
  summary: "Create a coupon template",
  request: {
    body: {
      content: { "application/json": { schema: couponTemplateCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: couponTemplateApiSchema } },
      description: "Created",
    },
  },
});

const listCouponTemplatesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Coupon template"],
  summary: "List coupon templates",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.array(couponTemplateApiSchema) },
      },
      description: "OK",
    },
  },
});

const getCouponTemplateRoute = createRoute({
  method: "get",
  path: "/{couponTemplateId}",
  tags: ["Coupon template"],
  summary: "Get a coupon template",
  request: { params: z.object({ couponTemplateId: couponTemplateIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: couponTemplateApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateCouponTemplateRoute = createRoute({
  method: "delete",
  path: "/{couponTemplateId}",
  tags: ["Coupon template"],
  summary: "Deprecate a coupon template",
  request: { params: z.object({ couponTemplateId: couponTemplateIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: couponTemplateApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const couponTemplateApp = new OpenAPIHono()
  .openapi(createCouponTemplateRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createCouponTemplate({ template: body }), 201);
  })
  .openapi(listCouponTemplatesRoute, async (c) => {
    return c.json(await listCouponTemplates(), 200);
  })
  .openapi(getCouponTemplateRoute, async (c) => {
    const template = await getCouponTemplate({
      couponTemplateId: c.req.param("couponTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template, 200);
  })
  .openapi(deprecateCouponTemplateRoute, async (c) => {
    const template = await deprecateCouponTemplate({
      couponTemplateId: c.req.param("couponTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template, 200);
  });
