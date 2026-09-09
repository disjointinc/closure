/**
 * v0/plan/routes.ts -- HTTP for /v0/plan: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { microcredits } from "../../schemas/common.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";
import {
  checkPlanMeter,
  planMeterFields,
  planSchema,
} from "../../schemas/plan.ts";
import { valueCreateSchema } from "../../schemas/value.ts";
import { createPlan, deprecatePlan, getPlan, listPlans } from "./service.ts";

// Prices reference first-class cycles by id but own their values, which are
// always passed as full objects.
const priceInputSchema = z.object({
  cycleId: cycleIdSchema,
  value: valueCreateSchema,
});

/** A top-up usage tier as passed on the wire: its prices own their values. */
export const topUpTierInputSchema = z.object({
  startingAt: microcredits.positive(),
  prices: z.array(priceInputSchema).min(1),
});

const planMeterInputSchema = z
  .object({
    ...planMeterFields,
    topUpPricesPerCredit: z.array(topUpTierInputSchema).min(1).nullable(),
  })
  .superRefine(checkPlanMeter);

const planCreateSchema = z
  .object(planSchema.shape)
  .omit({
    planId: true,
    createdAt: true,
    deprecatedAt: true,
  })
  .extend({
    prices: z.array(priceInputSchema),
    meters: z.array(planMeterInputSchema).nullable(),
  });

export type PlanMeterInput = z.infer<typeof planMeterInputSchema>;
export type PlanCreateBody = z.infer<typeof planCreateSchema>;

export const planApp = new Hono()
  .post("/", zValidator("json", planCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const plan = await createPlan({ plan: body });
    if ("error" in plan) {
      return c.json(plan, 400);
    }
    return c.json(plan, 201);
  })
  .get("/", async (c) => {
    return c.json(await listPlans());
  })
  .get("/:planId", async (c) => {
    const plan = await getPlan({ planId: c.req.param("planId") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(plan);
  })
  .delete("/:planId", async (c) => {
    const plan = await deprecatePlan({ planId: c.req.param("planId") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(plan);
  });
