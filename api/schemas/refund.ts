import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  paymentIdSchema,
  refundIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
  valueIdSchema,
} from "./ids.ts";

export const refundSchema = z.object({
  refundId: refundIdSchema,
  paymentId: paymentIdSchema.nullable(),
  loanPrincipalAmount: z.number().int().nonnegative().nullable(),
  loanInterestAmount: z.number().int().nonnegative().nullable(),
  tenantId: tenantIdSchema,
  createdAt: epochMs,
  startedProcessingAt: epochMs.nullable(),
  succeededAt: epochMs.nullable(),
  failedAt: epochMs.nullable(),
  byTeamMemberId: teamMemberIdSchema,
  valueId: valueIdSchema,
  reason: z.string().nullable(),
});
export type Refund = z.infer<typeof refundSchema>;
