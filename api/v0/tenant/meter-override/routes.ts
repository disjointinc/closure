/**
 * v0/tenant/meter-override/routes.ts -- HTTP for /v0/tenant/:tenantId/meter-override:
 * request validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { teamMemberIdSchema } from "../../../schemas/ids.ts";
import { checkPlanMeter, planMeterFields } from "../../../schemas/plan.ts";
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

export const meterOverrideApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", meterOverrideCreateSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const override = await createMeterOverride({ override: body, tenantId });
    return c.json(override, 201);
  })
  .get("/", async (c) => {
    return c.json(await listMeterOverrides({ tenantId: c.get("tenantId") }));
  });
