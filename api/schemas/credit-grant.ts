import { z } from "zod";
import { epochMs, microcredits } from "./common.ts";
import {
  creditGrantIdSchema,
  meterIdSchema,
  teamMemberIdSchema,
} from "./ids.ts";

export const creditGrantSchema = z.object({
  uniqueId: creditGrantIdSchema,
  meter: meterIdSchema,
  on: epochMs,
  by: teamMemberIdSchema,
  reason: z.string().nullable(),
  amount: microcredits.positive(),
});
export type CreditGrant = z.infer<typeof creditGrantSchema>;
