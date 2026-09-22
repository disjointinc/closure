/**
 * v0/coupon-template/routes.ts -- HTTP for /v0/coupon-template: request
 * validation and wiring. Business logic lives in service.ts.
 *
 * The wire speaks fractional credits; the service speaks microcredits.
 * Handlers convert at the boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import {
  checkCouponTemplate,
  couponTemplateSchema,
} from "../../schemas/coupon-template.ts";
import { featureSetTo } from "../../schemas/common.ts";
import { couponTemplateIdSchema, featureIdSchema } from "../../schemas/ids.ts";
import { awardSchema } from "../../schemas/coupon.ts";
import {
  creditGrantedToCredits,
  creditGrantedToMicrocredits,
  creditsGrantedWireSchema,
} from "../coupon/routes.ts";
import {
  createCouponTemplate,
  type CouponTemplateApi,
  type CouponTemplateCreateBody,
  deprecateCouponTemplate,
  getCouponTemplate,
  listCouponTemplates,
} from "./service.ts";

const featuresGrantedApiSchema = z.array(
  z.object({
    featureId: featureIdSchema,
    setTo: featureSetTo,
    award: awardSchema,
  }),
);

/** The template shape the call surface reads: credits, full award values. */
const couponTemplateWireApiSchema = z.object({
  ...couponTemplateSchema.shape,
  defaultAward: awardSchema.nullable(),
  featuresGranted: featuresGrantedApiSchema,
  creditsGranted: creditsGrantedWireSchema,
});
type CouponTemplateWireApi = z.infer<typeof couponTemplateWireApiSchema>;

const couponTemplateCreateWireSchema = z
  .object({
    ...couponTemplateSchema.shape,
    defaultAward: awardSchema.nullable(),
    featuresGranted: featuresGrantedApiSchema,
    creditsGranted: creditsGrantedWireSchema,
  })
  .omit({ couponTemplateId: true, createdAt: true, deprecatedAt: true })
  .superRefine(checkCouponTemplate);

export type CouponTemplateCreateWireBody = z.infer<
  typeof couponTemplateCreateWireSchema
>;

function templateCreateToMicrocredits({
  template,
}: {
  template: CouponTemplateCreateWireBody;
}): CouponTemplateCreateBody {
  return {
    ...template,
    creditsGranted: template.creditsGranted.map((credit) =>
      creditGrantedToMicrocredits({ credit }),
    ),
  };
}

function templateApiToCredits({
  template,
}: {
  template: CouponTemplateApi;
}): CouponTemplateWireApi {
  return {
    ...template,
    creditsGranted: template.creditsGranted.map((credit) =>
      creditGrantedToCredits({ credit }),
    ),
  };
}

const createCouponTemplateRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Coupon template"],
  summary: "Create a coupon template",
  request: {
    body: {
      content: {
        "application/json": { schema: couponTemplateCreateWireSchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: couponTemplateWireApiSchema } },
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
        "application/json": { schema: z.array(couponTemplateWireApiSchema) },
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
      content: { "application/json": { schema: couponTemplateWireApiSchema } },
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
      content: { "application/json": { schema: couponTemplateWireApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const couponTemplateApp = new OpenAPIHono()
  .openapi(createCouponTemplateRoute, async (c) => {
    const body = c.req.valid("json");
    const template = await createCouponTemplate({
      template: templateCreateToMicrocredits({ template: body }),
    });
    return c.json(templateApiToCredits({ template }), 201);
  })
  .openapi(listCouponTemplatesRoute, async (c) => {
    const templates = await listCouponTemplates();
    return c.json(
      templates.map((template) => templateApiToCredits({ template })),
      200,
    );
  })
  .openapi(getCouponTemplateRoute, async (c) => {
    const template = await getCouponTemplate({
      couponTemplateId: c.req.param("couponTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(templateApiToCredits({ template }), 200);
  })
  .openapi(deprecateCouponTemplateRoute, async (c) => {
    const template = await deprecateCouponTemplate({
      couponTemplateId: c.req.param("couponTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(templateApiToCredits({ template }), 200);
  });
