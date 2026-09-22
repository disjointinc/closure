/**
 * v0/plan/routes.ts -- HTTP for /v0/plan: request validation and wiring.
 * Business logic lives in service.ts.
 *
 * The wire speaks fractional credits; everything internal (services, db,
 * cache) speaks integer microcredits. The *Wire schemas present credits and
 * the handlers convert at the boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../lib/http.ts";
import {
  credits,
  creditsPositive,
  creditsToMicrocredits,
  microcreditsToCredits,
  renameIssueToCredits,
} from "../../lib/credits.ts";
import { priceSchema } from "../../schemas/common.ts";
import { planIdSchema } from "../../schemas/ids.ts";
import {
  checkPlanMeter,
  type Plan,
  type PlanMeter,
  planMeterFields,
  planSchema,
} from "../../schemas/plan.ts";
import {
  createPlan,
  deprecatePlan,
  getPlan,
  listPlans,
  type PlanCreateBody,
} from "./service.ts";

// Prices reference first-class cycles by id and carry their amounts inline.
/** A top-up pricing tier as passed on the wire: pack sizes are in credits. */
export const topUpTierWireSchema = z.object({
  startingAtPackSizeCredits: credits.nonnegative(),
  prices: z.array(priceSchema).min(1),
});

const topUpCreditPackSizesWireSchema = z.object({
  /** Each pack must be <= limitCredits (checked on the parent). */
  static: z.array(creditsPositive).nullable(),
  dynamic: z
    .object({
      packSizeIntervalCredits: creditsPositive,
      minimumPackSizeCredits: creditsPositive,
      /**
       * Must be > minimumPackSizeCredits and <= limitCredits (checked on
       * the parent).
       */
      maximumPackSizeCredits: creditsPositive.nullable(),
    })
    .refine(
      (dynamic) =>
        dynamic.maximumPackSizeCredits === null ||
        dynamic.maximumPackSizeCredits > dynamic.minimumPackSizeCredits,
      {
        message:
          "maximumPackSizeCredits must be greater than minimumPackSizeCredits",
        path: ["maximumPackSizeCredits"],
      },
    )
    .nullable(),
});
type TopUpCreditPackSizesWire = z.infer<typeof topUpCreditPackSizesWireSchema>;

/**
 * The wire's meter entry fields: credit-denominated twins of planMeterFields.
 * Exported so meter overrides (same shape, extra fields) reuse them.
 */
export const planMeterWireFields = {
  meterId: planMeterFields.meterId,
  defaultCredits: credits.nonnegative(),
  /** Must be >= defaultCredits. Null means unlimited. */
  limitCredits: creditsPositive.nullable(),
  /** Null means the allocation never resets. */
  reset: planMeterFields.reset,
  /** Reset periods unused credits roll over into. Null means unlimited. */
  rollovers: planMeterFields.rollovers,
  topUpCreditPackSizes: topUpCreditPackSizesWireSchema,
};

const planMeterWireInputSchema = z
  .object({
    ...planMeterWireFields,
    topUpPricesPerCredit: z.array(topUpTierWireSchema),
  })
  .superRefine(checkPlanMeterWire);

const planMeterWireApiSchema = z.object({
  ...planMeterWireFields,
  topUpPricesPerCredit: z.array(topUpTierWireSchema),
});

export type PlanMeterWireInput = z.infer<typeof planMeterWireInputSchema>;
export type PlanMeterWireApi = z.infer<typeof planMeterWireApiSchema>;

function packSizesToMicrocredits({
  packSizes,
}: {
  packSizes: TopUpCreditPackSizesWire;
}): PlanMeter["topUpCreditPackSizes"] {
  const dynamic = packSizes.dynamic;
  return {
    static:
      packSizes.static === null
        ? null
        : packSizes.static.map((credits) => creditsToMicrocredits({ credits })),
    dynamic:
      dynamic === null
        ? null
        : {
            packSizeIntervalMicrocredits: creditsToMicrocredits({
              credits: dynamic.packSizeIntervalCredits,
            }),
            minimumPackSizeMicrocredits: creditsToMicrocredits({
              credits: dynamic.minimumPackSizeCredits,
            }),
            maximumPackSizeMicrocredits:
              dynamic.maximumPackSizeCredits === null
                ? null
                : creditsToMicrocredits({
                    credits: dynamic.maximumPackSizeCredits,
                  }),
          },
  };
}

function packSizesToCredits({
  packSizes,
}: {
  packSizes: PlanMeter["topUpCreditPackSizes"];
}): TopUpCreditPackSizesWire {
  const dynamic = packSizes.dynamic;
  return {
    static:
      packSizes.static === null
        ? null
        : packSizes.static.map((microcredits) =>
            microcreditsToCredits({ microcredits }),
          ),
    dynamic:
      dynamic === null
        ? null
        : {
            packSizeIntervalCredits: microcreditsToCredits({
              microcredits: dynamic.packSizeIntervalMicrocredits,
            }),
            minimumPackSizeCredits: microcreditsToCredits({
              microcredits: dynamic.minimumPackSizeMicrocredits,
            }),
            maximumPackSizeCredits:
              dynamic.maximumPackSizeMicrocredits === null
                ? null
                : microcreditsToCredits({
                    microcredits: dynamic.maximumPackSizeMicrocredits,
                  }),
          },
  };
}

/** Convert a wire meter entry to the internal microcredits input shape. */
export function planMeterInputToMicrocredits({
  meter,
}: {
  meter: PlanMeterWireInput;
}): PlanMeter {
  return {
    meterId: meter.meterId,
    defaultMicrocredits: creditsToMicrocredits({
      credits: meter.defaultCredits,
    }),
    limitMicrocredits:
      meter.limitCredits === null
        ? null
        : creditsToMicrocredits({ credits: meter.limitCredits }),
    reset: meter.reset,
    rollovers: meter.rollovers,
    topUpPricesPerCredit: meter.topUpPricesPerCredit.map((tier) => ({
      startingAtPackSizeMicrocredits: creditsToMicrocredits({
        credits: tier.startingAtPackSizeCredits,
      }),
      prices: tier.prices,
    })),
    topUpCreditPackSizes: packSizesToMicrocredits({
      packSizes: meter.topUpCreditPackSizes,
    }),
  };
}

/** Convert a service's meter entry to the wire's credit shape. */
export function planMeterApiToCredits({
  meter,
}: {
  meter: PlanMeter;
}): PlanMeterWireApi {
  return {
    meterId: meter.meterId,
    defaultCredits: microcreditsToCredits({
      microcredits: meter.defaultMicrocredits,
    }),
    limitCredits:
      meter.limitMicrocredits === null
        ? null
        : microcreditsToCredits({ microcredits: meter.limitMicrocredits }),
    reset: meter.reset,
    rollovers: meter.rollovers,
    topUpPricesPerCredit: meter.topUpPricesPerCredit.map((tier) => ({
      startingAtPackSizeCredits: microcreditsToCredits({
        microcredits: tier.startingAtPackSizeMicrocredits,
      }),
      prices: tier.prices,
    })),
    topUpCreditPackSizes: packSizesToCredits({
      packSizes: meter.topUpCreditPackSizes,
    }),
  };
}

/**
 * checkPlanMeter on the wire shape: convert to microcredits, then rewrite
 * issue names so validation messages never mention microcredits.
 */
export function checkPlanMeterWire(
  meter: PlanMeterWireInput,
  ctx: z.RefinementCtx,
): void {
  const internal = planMeterInputToMicrocredits({ meter });
  checkPlanMeter(internal, {
    value: internal,
    issues: [],
    addIssue: (issue) => {
      if (typeof issue === "string") {
        ctx.addIssue(issue);
        return;
      }
      ctx.addIssue(renameIssueToCredits({ issue }));
    },
  });
}

function planCreateToMicrocredits({
  plan,
}: {
  plan: PlanCreateWireBody;
}): PlanCreateBody {
  return {
    ...plan,
    meters: plan.meters.map((meter) => planMeterInputToMicrocredits({ meter })),
  };
}

function planApiToCredits({ plan }: { plan: Plan }): PlanWireApi {
  return {
    ...plan,
    meters: plan.meters.map((meter) => planMeterApiToCredits({ meter })),
  };
}

/** The plan shape the call surface reads: meters in credits. */
const planWireApiSchema = planSchema.extend({
  meters: z.array(planMeterWireApiSchema),
});
type PlanWireApi = z.infer<typeof planWireApiSchema>;

const planCreateWireSchema = z
  .object(planSchema.shape)
  .omit({
    planId: true,
    createdAt: true,
    deprecatedAt: true,
  })
  .extend({
    meters: z.array(planMeterWireInputSchema),
  });
export type PlanCreateWireBody = z.infer<typeof planCreateWireSchema>;

const createPlanRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Plan"],
  summary: "Create a plan",
  request: {
    body: {
      content: { "application/json": { schema: planCreateWireSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: planWireApiSchema } },
      description: "Created",
    },
    400: invalidResponse,
  },
});

const listPlansRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Plan"],
  summary: "List plans",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(planWireApiSchema) } },
      description: "OK",
    },
  },
});

const getPlanRoute = createRoute({
  method: "get",
  path: "/{planId}",
  tags: ["Plan"],
  summary: "Get a plan",
  request: { params: z.object({ planId: planIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: planWireApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecatePlanRoute = createRoute({
  method: "delete",
  path: "/{planId}",
  tags: ["Plan"],
  summary: "Deprecate a plan",
  request: { params: z.object({ planId: planIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: planWireApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const planApp = new OpenAPIHono()
  .openapi(createPlanRoute, async (c) => {
    const body = c.req.valid("json");
    const plan = await createPlan({
      plan: planCreateToMicrocredits({ plan: body }),
    });
    if ("error" in plan) {
      return c.json(plan, 400);
    }
    return c.json(planApiToCredits({ plan }), 201);
  })
  .openapi(listPlansRoute, async (c) => {
    const plans = await listPlans();
    return c.json(
      plans.map((plan) => planApiToCredits({ plan })),
      200,
    );
  })
  .openapi(getPlanRoute, async (c) => {
    const plan = await getPlan({ planId: c.req.param("planId") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(planApiToCredits({ plan }), 200);
  })
  .openapi(deprecatePlanRoute, async (c) => {
    const plan = await deprecatePlan({ planId: c.req.param("planId") });
    if (!plan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(planApiToCredits({ plan }), 200);
  });
