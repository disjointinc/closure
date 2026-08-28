import { z } from "zod";
import { epochMs, microcredits } from "./common.ts";
import {
  creditGrantIdSchema,
  meterIdSchema,
  teamMemberIdSchema,
} from "./ids.ts";

export const creditGrantSchema = z.object({
  creditGrantId: creditGrantIdSchema,
  meterId: meterIdSchema,
  grantedAt: epochMs,
  byTeamMemberId: teamMemberIdSchema,
  reason: z.string().nullable(),
  amountMicrocredits: microcredits.positive(),
});
export type CreditGrant = z.infer<typeof creditGrantSchema>;
