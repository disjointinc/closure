/**
 * v0/coupon-templates/routes.ts -- HTTP for /v0/coupon-templates: request
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
import { awardInputSchema } from "../awards/service.ts";
import {
  createCouponTemplate,
  deprecateCouponTemplate,
  getCouponTemplate,
  listCouponTemplates,
} from "./service.ts";

const couponTemplateCreateSchema = z
  .object({
    ...couponTemplateSchema.shape,
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
  .superRefine(checkCouponTemplate);

export type CouponTemplateCreateBody = z.infer<
  typeof couponTemplateCreateSchema
>;

export const couponTemplatesApp = new Hono()
  .post("/", zValidator("json", couponTemplateCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createCouponTemplate({ template: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listCouponTemplates());
  })
  .get("/:id", async (c) => {
    const template = await getCouponTemplate({ uniqueId: c.req.param("id") });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template);
  })
  .delete("/:id", async (c) => {
    const template = await deprecateCouponTemplate({
      uniqueId: c.req.param("id"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template);
  });
