import { z } from "zod";
import { epochMs } from "./common.ts";
import { refundIdSchema, teamMemberIdSchema, valueIdSchema } from "./ids.ts";

export const refundSchema = z.object({
  unique_id: refundIdSchema,
  on: epochMs,
  by: teamMemberIdSchema,
  value: valueIdSchema,
  reason: z.string().nullable(),
});
export type Refund = z.infer<typeof refundSchema>;
