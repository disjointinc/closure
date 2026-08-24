import { z } from "zod";
import { cron, epochMs } from "./common.ts";
import { cycleIdSchema, valueIdSchema } from "./ids.ts";

export const dunningActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("retry_customer"),
    notes: z.string(),
  }),
  z.object({
    type: z.literal("add_late_fee"),
    fixed_value: valueIdSchema,
    percentage: z.number().positive(),
  }),
]);
export type DunningAction = z.infer<typeof dunningActionSchema>;

export const upfrontChargingSchema = z.object({
  charged: z.literal("upfront"),
  cycle_length: z.union([cron, z.literal("one-time")]),
});

export const arrearsChargingSchema = z.object({
  charged: z.literal("arrears"),
  cycle_length: cron,
  credit_period: cron,
  grace_period: cron.optional(),
  dunning_schedule: z.array(
    z.object({
      after: cron,
      actions: z.array(dunningActionSchema).min(1),
    }),
  ),
});

/** How a cycle or invoice gets collected. */
export const chargingSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema,
  arrearsChargingSchema,
]);
export type Charging = z.infer<typeof chargingSchema>;

const cycleFields = {
  unique_id: cycleIdSchema,
  created_at: epochMs,
  deprecated_at: epochMs.optional(),
  name: z.string().min(1),
  description: z.string().optional(),
};

export const cycleSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(cycleFields),
  arrearsChargingSchema.extend(cycleFields),
]);
export type Cycle = z.infer<typeof cycleSchema>;
