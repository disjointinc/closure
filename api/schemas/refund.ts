import { z } from "zod";
import { epochMs } from "./common.ts";
import { refundIdSchema, teamMemberIdSchema, valueIdSchema } from "./ids.ts";

export const refundSchema = z.object({
  uniqueId: refundIdSchema,
  createdAt: epochMs,
  startedProcessingAt: epochMs.nullable(),
  succeededAt: epochMs.nullable(),
  failedAt: epochMs.nullable(),
  by: teamMemberIdSchema,
  value: valueIdSchema,
  reason: z.string().nullable(),
});
export type Refund = z.infer<typeof refundSchema>;
