/**
 * v0/tenant/meter-override/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-override:
 * request validation and wiring. Business logic lives in service.ts.
 *
 * The wire speaks fractional credits; the service speaks microcredits.
 * Handlers convert at the boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { epochMs } from "../../../schemas/common.ts";
import {
  meterOverrideIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "../../../schemas/ids.ts";
import {
  checkPlanMeterWire,
  planMeterApiToCredits,
  planMeterInputToMicrocredits,
  planMeterWireFields,
  topUpTierWireApiSchema,
  topUpTierWireInputSchema,
} from "../../plan/routes.ts";
import { createMeterOverride, listMeterOverrides } from "./service.ts";

/** The wire create shape: credit-denominated meter fields. */
const meterOverrideCreateWireSchema = z
  .object({
    ...planMeterWireFields,
    topUpPricesPerCredit: z.array(topUpTierWireInputSchema).min(1).nullable(),
    byTeamMemberId: teamMemberIdSchema,
    reason: z.string().nullable(),
  })
  .superRefine(checkPlanMeterWire);

/** The call-surface override: credits on the wire, full top-up values. */
const meterOverrideWireApiSchema = z.object({
  ...planMeterWireFields,
  topUpPricesPerCredit: z.array(topUpTierWireApiSchema).min(1).nullable(),
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
      content: {
        "application/json": { schema: meterOverrideCreateWireSchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: meterOverrideWireApiSchema } },
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
        "application/json": { schema: z.array(meterOverrideWireApiSchema) },
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
    const override = await createMeterOverride({
      override: {
        ...planMeterInputToMicrocredits({ meter: body }),
        byTeamMemberId: body.byTeamMemberId,
        reason: body.reason,
      },
      tenantId,
    });
    return c.json(
      {
        ...planMeterApiToCredits({ meter: override }),
        meterOverrideId: override.meterOverrideId,
        tenantId: override.tenantId,
        createdAt: override.createdAt,
        byTeamMemberId: override.byTeamMemberId,
        reason: override.reason,
      },
      201,
    );
  })
  .openapi(listMeterOverridesRoute, async (c) => {
    const overrides = await listMeterOverrides({ tenantId: c.get("tenantId") });
    return c.json(
      overrides.map((override) => ({
        ...planMeterApiToCredits({ meter: override }),
        meterOverrideId: override.meterOverrideId,
        tenantId: override.tenantId,
        createdAt: override.createdAt,
        byTeamMemberId: override.byTeamMemberId,
        reason: override.reason,
      })),
      200,
    );
  });
