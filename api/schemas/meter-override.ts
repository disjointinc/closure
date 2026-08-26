import { z } from "zod";
import { epochMs } from "./common.ts";
import { meterOverrideIdSchema, teamMemberIdSchema } from "./ids.ts";
import { checkPlanMeter, planMeterFields } from "./plan.ts";

/** A team-member-applied tweak to a tenant's meter, per the plan structure. */
export const meterOverrideSchema = z
  .object({
    ...planMeterFields,
    uniqueId: meterOverrideIdSchema,
    on: epochMs,
    by: teamMemberIdSchema,
    reason: z.string().nullable(),
  })
  .superRefine(checkPlanMeter);
export type MeterOverride = z.infer<typeof meterOverrideSchema>;
