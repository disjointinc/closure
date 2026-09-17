/**
 * v0/tenant/meter-override/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-override:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { epochMs, microcredits } from "../../../schemas/common.ts";
import {
  cycleIdSchema,
  meterOverrideIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "../../../schemas/ids.ts";
import { checkPlanMeter, planMeterFields } from "../../../schemas/plan.ts";
import { valueSchema } from "../../../schemas/value.ts";
import { topUpTierInputSchema } from "../../plan/routes.ts";
import { createMeterOverride, listMeterOverrides } from "./service.ts";

/**
 * meterOverrideSchema minus what the server stamps (meterOverrideId,
 * createdAt) and the tenantId (it's the one in the path). Rebuilt from the
 * field list: zod can't .omit() an object carrying refinements. Top-up
 * prices take full values where the canonical schema keeps value ids.
 */
const meterOverrideCreateSchema = z
  .object({
    ...planMeterFields,
    topUpPricesPerCredit: z.array(topUpTierInputSchema).min(1).nullable(),
    byTeamMemberId: teamMemberIdSchema,
    reason: z.string().nullable(),
  })
  .superRefine(checkPlanMeter);

export type MeterOverrideCreateBody = z.infer<typeof meterOverrideCreateSchema>;

// The call-surface top-up tier: prices own their values.
const topUpTierApiSchema = z.object({
  startingAt: microcredits.positive(),
  prices: z
    .array(z.object({ cycleId: cycleIdSchema, value: valueSchema }))
    .min(1),
});

/** The call-surface override: top-up prices carry full values. */
const meterOverrideApiSchema = z.object({
  ...planMeterFields,
  topUpPricesPerCredit: z.array(topUpTierApiSchema).min(1).nullable(),
  meterOverrideId: meterOverrideIdSchema,
  tenantId: tenantIdSchema,
  createdAt: epochMs,
  byTeamMemberId: teamMemberIdSchema,
  reason: z.string().nullable(),
});

const createMeterOverrideRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tenant > Meter override"],
  summary: "Create a meter override",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: meterOverrideCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: meterOverrideApiSchema } },
      description: "Created",
    },
  },
});

const listMeterOverridesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tenant > Meter override"],
  summary: "List meter overrides",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.array(meterOverrideApiSchema) },
      },
      description: "OK",
    },
  },
});

export const meterOverrideApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createMeterOverrideRoute, async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const override = await createMeterOverride({ override: body, tenantId });
    return c.json(override, 201);
  })
  .openapi(listMeterOverridesRoute, async (c) => {
    return c.json(
      await listMeterOverrides({ tenantId: c.get("tenantId") }),
      200,
    );
  });
