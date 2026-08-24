import { z } from "zod";
import { durationSchema, epochMs } from "./common.ts";
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
  cycle_length: z.union([durationSchema, z.literal("one-time")]),
});

export const arrearsChargingSchema = z.object({
  charged: z.literal("arrears"),
  cycle_length: durationSchema,
  credit_period: durationSchema,
  grace_period: durationSchema.nullable(),
  dunning_schedule: z.array(
    z.object({
      /** How long after the due date these actions trigger. */
      after: durationSchema,
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
  deprecated_at: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
};

export const cycleSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(cycleFields),
  arrearsChargingSchema.extend(cycleFields),
]);
export type Cycle = z.infer<typeof cycleSchema>;
