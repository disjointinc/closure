/**
 * v0/coupon/routes.ts -- HTTP for /v0/coupon: request validation and
 * wiring. Business logic lives in service.ts.
 *
 * The wire speaks fractional credits; the service speaks microcredits.
 * Handlers convert at the boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import {
  creditsPositive,
  creditsToMicrocredits,
  microcreditsToCredits,
} from "../../lib/credits.ts";
import { featureSetTo, resetSchedule } from "../../schemas/common.ts";
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
  type CouponApi,
  type CouponCreateBody,
  deleteCoupon,
  getCoupon,
  listCoupons,
} from "./service.ts";

/** Credits granted as passed on the wire: amountCredits is in credits. */
export const creditsGrantedWireSchema = z
  .array(
    z.object({
      meterId: meterIdSchema,
      amountCredits: creditsPositive,
      expiration: resetSchedule.nullable(),
      rollovers: z.number().int().nonnegative().nullable(),
      award: awardApiSchema,
    }),
  )
  .nullable();

/** The service's credits-granted entry: microcredits, full award values. */
type CreditGranted = NonNullable<CouponApi["creditsGranted"]>[number];
type CreditGrantedWire = NonNullable<
  z.infer<typeof creditsGrantedWireSchema>
>[number];

export function creditGrantedToMicrocredits({
  credit,
}: {
  credit: CreditGrantedWire;
}): CreditGranted {
  const { amountCredits, ...rest } = credit;
  return {
    ...rest,
    amountMicrocredits: creditsToMicrocredits({ credits: amountCredits }),
  };
}

export function creditGrantedToCredits({
  credit,
}: {
  credit: CreditGranted;
}): CreditGrantedWire {
  const { amountMicrocredits, ...rest } = credit;
  return {
    ...rest,
    amountCredits: microcreditsToCredits({ microcredits: amountMicrocredits }),
  };
}

const featuresGrantedSchema = z
  .array(
    z.object({
      featureId: featureIdSchema,
      setTo: featureSetTo,
      award: awardApiSchema,
    }),
  )
  .nullable();

const couponDefinitionWireFields = {
  grantableByTenants: z.boolean(),
  /** Only settable when grantableByTenants. Null means no limit. */
  limitPerGrantingTenant: z.number().int().positive().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  defaultAward: awardApiSchema.nullable(),
  featuresGranted: featuresGrantedSchema,
  creditsGranted: creditsGrantedWireSchema,
  /** Only settable when grantableByTenants. */
  reciprocalBenefitCouponId: couponIdSchema.nullable(),
};

const couponCreateWireSchema = z.union([
  // Inline definition.
  z
    .object({
      couponTemplateId: z.null(),
      ...couponDefinitionWireFields,
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

export type CouponCreateWireBody = z.infer<typeof couponCreateWireSchema>;

/** The coupon shape the call surface reads: credits, awards with full values. */
const couponWireApiSchema = z.object({
  // couponSchema is refined, so rebuild its shape rather than .extend() it.
  ...couponSchema.shape,
  defaultAward: awardApiSchema.nullable(),
  featuresGranted: featuresGrantedSchema,
  creditsGranted: creditsGrantedWireSchema,
});
type CouponWireApi = z.infer<typeof couponWireApiSchema>;

function couponCreateToMicrocredits({
  coupon,
}: {
  coupon: CouponCreateWireBody;
}): CouponCreateBody {
  // An explicit null check, not a truthiness check: the template branch's
  // couponTemplateId is a string, and "" is falsy, so truthiness wouldn't
  // narrow the union.
  if (coupon.couponTemplateId !== null) {
    return coupon;
  }
  return {
    ...coupon,
    creditsGranted:
      coupon.creditsGranted === null
        ? null
        : coupon.creditsGranted.map((credit) =>
            creditGrantedToMicrocredits({ credit }),
          ),
  };
}

function couponApiToCredits({ coupon }: { coupon: CouponApi }): CouponWireApi {
  return {
    ...coupon,
    creditsGranted:
      coupon.creditsGranted === null
        ? null
        : coupon.creditsGranted.map((credit) =>
            creditGrantedToCredits({ credit }),
          ),
  };
}

const createCouponRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Coupon"],
  summary: "Create a coupon",
  request: {
    body: {
      content: { "application/json": { schema: couponCreateWireSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: couponWireApiSchema } },
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
      content: { "application/json": { schema: z.array(couponWireApiSchema) } },
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
      content: { "application/json": { schema: couponWireApiSchema } },
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
      content: { "application/json": { schema: couponWireApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const couponApp = new OpenAPIHono()
  .openapi(createCouponRoute, async (c) => {
    const body = c.req.valid("json");
    const coupon = await createCoupon({
      coupon: couponCreateToMicrocredits({ coupon: body }),
    });
    if (!coupon) {
      return c.json({ error: "template not found" }, 404);
    }
    return c.json(couponApiToCredits({ coupon }), 201);
  })
  .openapi(listCouponsRoute, async (c) => {
    const coupons = await listCoupons();
    return c.json(
      coupons.map((coupon) => couponApiToCredits({ coupon })),
      200,
    );
  })
  .openapi(getCouponRoute, async (c) => {
    const coupon = await getCoupon({ couponId: c.req.param("couponId") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(couponApiToCredits({ coupon }), 200);
  })
  .openapi(deleteCouponRoute, async (c) => {
    const coupon = await deleteCoupon({ couponId: c.req.param("couponId") });
    if (!coupon) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(couponApiToCredits({ coupon }), 200);
  });
