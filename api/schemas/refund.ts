import { z } from "zod";
import { epochMs } from "./common.ts";
import { refundIdSchema, teamMemberIdSchema, valueIdSchema } from "./ids.ts";

export const refundSchema = z.object({
  unique_id: refundIdSchema,
  created_at: epochMs,
  started_processing_at: epochMs.nullable(),
  succeeded_at: epochMs.nullable(),
  failed_at: epochMs.nullable(),
  by: teamMemberIdSchema,
  value: valueIdSchema,
  reason: z.string().nullable(),
});
export type Refund = z.infer<typeof refundSchema>;
