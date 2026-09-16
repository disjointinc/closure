import { z } from "zod";
import { epochMs } from "./common.ts";
import { loanIdSchema, writeOffIdSchema } from "./ids.ts";

/** Standardized reasons a creditor abandons collection on a loan. */
export const writeOffCodeSchema = z.enum([
  "uncollectible",
  "bankrupt",
  "deceased",
  "fraud",
  "billing_error",
  "goodwill",
  "other",
]);
export type WriteOffCode = z.infer<typeof writeOffCodeSchema>;

/**
 * A write-off event: the creditor stopped collecting the loan at createdAt.
 * Append-only history; the loan's writeOffId is the current-state pointer.
 */
export const writeOffSchema = z.object({
  writeOffId: writeOffIdSchema,
  loanId: loanIdSchema,
  createdAt: epochMs,
  code: writeOffCodeSchema,
  reason: z.string().nullable(),
});
export type WriteOff = z.infer<typeof writeOffSchema>;
