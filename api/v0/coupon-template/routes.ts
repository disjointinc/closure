/**
 * v0/coupon-template/routes.ts -- HTTP for /v0/coupon-template: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  featureSetTo,
  microcredits,
  resetSchedule,
} from "../../schemas/common.ts";
import {
  checkCouponTemplate,
  couponTemplateSchema,
} from "../../schemas/coupon-template.ts";
import { featureIdSchema, meterIdSchema } from "../../schemas/ids.ts";
import { awardApiSchema } from "../award/service.ts";
import {
  createCouponTemplate,
  deprecateCouponTemplate,
  getCouponTemplate,
  listCouponTemplates,
} from "./service.ts";

const couponTemplateCreateSchema = z
  .object({
    ...couponTemplateSchema.shape,
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
  })
  .superRefine(checkCouponTemplate);

export type CouponTemplateCreateBody = z.infer<
  typeof couponTemplateCreateSchema
>;

export const couponTemplateApp = new Hono()
  .post("/", zValidator("json", couponTemplateCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createCouponTemplate({ template: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listCouponTemplates());
  })
  .get("/:couponTemplateId", async (c) => {
    const template = await getCouponTemplate({
      couponTemplateId: c.req.param("couponTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template);
  })
  .delete("/:couponTemplateId", async (c) => {
    const template = await deprecateCouponTemplate({
      couponTemplateId: c.req.param("couponTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template);
  });
