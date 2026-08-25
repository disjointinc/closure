/**
 * v0/plans/routes.ts -- HTTP for /v0/plans: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { microcredits } from "../../schemas/common.ts";
import {
  checkPlanMeter,
  planMeterFields,
  planSchema,
} from "../../schemas/plan.ts";
import { cycleRefSchema } from "../cycles/service.ts";
import { valueRefSchema } from "../values/service.ts";
import { createPlan, deprecatePlan, getPlan, listPlans } from "./service.ts";

const priceInputSchema = z.object({
  cycle: cycleRefSchema,
  value: valueRefSchema,
});

const planMeterInputSchema = z
  .object({
    ...planMeterFields,
    top_up_prices_per_credit: z
      .union([
        valueRefSchema,
        z
          .array(
            z.object({
              starting_at: microcredits.positive(),
              prices: z.array(priceInputSchema).min(1),
            }),
          )
          .min(1),
      ])
      .nullable(),
  })
  .superRefine(checkPlanMeter);

const planCreateSchema = z.object({
  ...planSchema.shape,
  prices: z.array(priceInputSchema),
  meters: z.array(planMeterInputSchema).nullable(),
});

export type PlanMeterInput = z.infer<typeof planMeterInputSchema>;
export type PlanCreateBody = z.infer<typeof planCreateSchema>;

export const plansApp = new Hono()
  .post("/", zValidator("json", planCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createPlan({ plan: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listPlans());
  })
  .get("/:id", async (c) => {
    const plan = await getPlan({ uniqueId: c.req.param("id") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(plan);
  })
  .delete("/:id", async (c) => {
    const plan = await deprecatePlan({ uniqueId: c.req.param("id") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(plan);
  });
