import { z } from "zod";
import { epochMs, microcredits } from "./common.ts";
import { meterEventIdSchema, meterIdSchema, tenantIdSchema } from "./ids.ts";

export const meterEventSchema = z.object({
  meterEventId: meterEventIdSchema,
  /**
   * The caller's idempotency key: repeat deliveries with the same external
   * id return the original outcome without double-charging. Null means "no
   * key" -- defaults to the meter event id at ingest, so callers who don't
   * need idempotent redelivery never have to mint a second id.
   */
  externalId: z.string().min(1).nullable(),
  createdAt: epochMs,
  meterId: meterIdSchema,
  tenantId: tenantIdSchema,
  /**
   * Signed: positive charges credits, negative refunds them. Zero events are
   * meaningless; the pg CHECK constraint mirrors this.
   */
  amountMicrocredits: microcredits.refine(
    (value) => value !== 0,
    "amountMicrocredits must be nonzero",
  ),
  status: z.enum(["succeeded", "insufficient_balance", "unexpected_error"]),
});
export type MeterEvent = z.infer<typeof meterEventSchema>;
