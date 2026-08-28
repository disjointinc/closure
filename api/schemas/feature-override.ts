import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  featureOverrideIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "./ids.ts";
import { planFeatureSchema } from "./plan.ts";

/** A team-member-applied tweak to a tenant's feature, per the plan structure. */
export const featureOverrideSchema = planFeatureSchema.extend({
  featureOverrideId: featureOverrideIdSchema,
  tenantId: tenantIdSchema,
  createdAt: epochMs,
  byTeamMemberId: teamMemberIdSchema,
  reason: z.string().nullable(),
});
export type FeatureOverride = z.infer<typeof featureOverrideSchema>;
