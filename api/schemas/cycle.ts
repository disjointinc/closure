import { z } from "zod";
import { durationSchema, epochMs } from "./common.ts";
import { cycleIdSchema } from "./ids.ts";

export const upfrontChargingSchema = z.object({
  charged: z.literal("upfront"),
  cycleLength: z.union([durationSchema, z.literal("one_time")]),
});

export const arrearsChargingSchema = z.object({
  charged: z.literal("arrears"),
  cycleLength: durationSchema,
  creditPeriod: durationSchema,
  gracePeriod: durationSchema.nullable(),
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
  defaultDiscountPercentage: z.number().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
};

export const cycleSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(cycleFields),
  arrearsChargingSchema.extend(cycleFields),
]);
export type Cycle = z.infer<typeof cycleSchema>;
