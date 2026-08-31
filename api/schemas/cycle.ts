import { z } from "zod";
import { durationSchema, epochMs } from "./common.ts";
import { cycleIdSchema, valueIdSchema } from "./ids.ts";

export const dunningActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("retry_customer"),
    notes: z.string(),
  }),
  // A late fee is a flat amount and/or a percentage of the invoice; at least
  // one must be set.
  z
    .object({
      type: z.literal("add_late_fee"),
      fixedValueId: valueIdSchema.nullable(),
      percentageOfInvoice: z.number().positive().nullable(),
    })
    .refine(
      (action) =>
        action.fixedValueId !== null || action.percentageOfInvoice !== null,
      {
        message: "add_late_fee requires a flat fee and/or a percentage",
      },
    ),
]);
export type DunningAction = z.infer<typeof dunningActionSchema>;

export const upfrontChargingSchema = z.object({
  charged: z.literal("upfront"),
  cycleLength: z.union([durationSchema, z.literal("one_time")]),
});

export const arrearsChargingSchema = z.object({
  charged: z.literal("arrears"),
  cycleLength: durationSchema,
  creditPeriod: durationSchema,
  gracePeriod: durationSchema.nullable(),
  dunningSchedule: z.array(
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
  cycleId: cycleIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
};

export const cycleSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(cycleFields),
  arrearsChargingSchema.extend(cycleFields),
]);
export type Cycle = z.infer<typeof cycleSchema>;
