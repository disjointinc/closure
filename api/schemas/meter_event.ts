import { z } from "zod";
import { epochMs, microcredits } from "./common.ts";
import { meterEventIdSchema, meterIdSchema, tenantIdSchema } from "./ids.ts";

export const meterEventSchema = z.object({
  unique_id: meterEventIdSchema,
  /**
   * The caller's idempotency key: repeat deliveries with the same external
   * id return the original outcome without double-charging. Optional --
   * defaults to unique_id at ingest, so callers who don't need idempotent
   * redelivery never have to mint a second id.
   */
  unique_external_id: z.string().min(1).optional(),
  created_at: epochMs,
  meter: meterIdSchema,
  tenant: tenantIdSchema,
  /**
   * Signed: positive charges credits, negative refunds them. Zero events are
   * meaningless; the pg CHECK constraint mirrors this.
   */
  amount: microcredits.refine((value) => value !== 0, "amount must be nonzero"),
  status: z.enum(["succeeded", "insufficient_balance", "unexpected_error"]),
});
export type MeterEvent = z.infer<typeof meterEventSchema>;
