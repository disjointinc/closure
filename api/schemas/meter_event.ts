import { z } from "zod";
import { epochMs, microcredits } from "./common.ts";
import { meterEventIdSchema, meterIdSchema, tenantIdSchema } from "./ids.ts";

export const meterEventSchema = z.object({
  unique_id: meterEventIdSchema,
  /**
   * The caller's idempotency key: ideally unique per event, used to make
   * metering idempotent.
   */
  ideally_unique_external_id: z.string().min(1),
  created_at: epochMs,
  meter: meterIdSchema,
  tenant: tenantIdSchema,
  amount: microcredits.positive(),
  status: z.enum(["succeeded", "insufficient_balance", "unexpected_error"]),
});
export type MeterEvent = z.infer<typeof meterEventSchema>;
