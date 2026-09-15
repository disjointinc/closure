/**
 * v0/plan/routes.ts -- HTTP for /v0/plan: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../lib/http.ts";
import { microcredits } from "../../schemas/common.ts";
import { cycleIdSchema, planIdSchema } from "../../schemas/ids.ts";
import {
  checkPlanMeter,
  planMeterFields,
  planSchema,
} from "../../schemas/plan.ts";
import { valueCreateSchema, valueSchema } from "../../schemas/value.ts";
import { createPlan, deprecatePlan, getPlan, listPlans } from "./service.ts";

// Prices reference first-class cycles by id but own their values, which are
// always passed as full objects.
const priceInputSchema = z.object({
  cycleId: cycleIdSchema,
  value: valueCreateSchema,
});

const priceApiSchema = z.object({
  cycleId: cycleIdSchema,
  value: valueSchema,
});

/** A top-up usage tier as passed on the wire: its prices own their values. */
export const topUpTierInputSchema = z.object({
  startingAt: microcredits.positive(),
  prices: z.array(priceInputSchema).min(1),
});

const topUpTierApiSchema = z.object({
  startingAt: microcredits.positive(),
  prices: z.array(priceApiSchema).min(1),
});

const planMeterInputSchema = z
  .object({
    ...planMeterFields,
    topUpPricesPerCredit: z.array(topUpTierInputSchema).min(1).nullable(),
  })
  .superRefine(checkPlanMeter);

const planMeterApiSchema = z.object({
  ...planMeterFields,
  topUpPricesPerCredit: z.array(topUpTierApiSchema).min(1).nullable(),
});

/** The plan shape the call surface reads: prices carry full values. */
const planApiSchema = planSchema.extend({
  prices: z.array(priceApiSchema),
  meters: z.array(planMeterApiSchema).nullable(),
});

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

const createPlanRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["plan"],
  summary: "Create a plan",
  request: {
    body: {
      content: { "application/json": { schema: planCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: planApiSchema } },
      description: "Created",
    },
    400: invalidResponse,
  },
});

const listPlansRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["plan"],
  summary: "List plans",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(planApiSchema) } },
      description: "OK",
    },
  },
});

const getPlanRoute = createRoute({
  method: "get",
  path: "/{planId}",
  tags: ["plan"],
  summary: "Get a plan",
  request: { params: z.object({ planId: planIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: planApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecatePlanRoute = createRoute({
  method: "delete",
  path: "/{planId}",
  tags: ["plan"],
  summary: "Deprecate a plan",
  request: { params: z.object({ planId: planIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: planApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const planApp = new OpenAPIHono()
  .openapi(createPlanRoute, async (c) => {
    const body = c.req.valid("json");
    const plan = await createPlan({ plan: body });
    if ("error" in plan) {
      return c.json(plan, 400);
    }
    return c.json(plan, 201);
  })
  .openapi(listPlansRoute, async (c) => {
    return c.json(await listPlans(), 200);
  })
  .openapi(getPlanRoute, async (c) => {
    const plan = await getPlan({ planId: c.req.param("planId") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(plan, 200);
  })
  .openapi(deprecatePlanRoute, async (c) => {
    const plan = await deprecatePlan({ planId: c.req.param("planId") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(plan, 200);
  });
