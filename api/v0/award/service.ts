/**
 * v0/award/service.ts -- award business logic. Awards have no route of
 * their own: they're composed into coupons and coupon templates. The call
 * surface passes flat_discount/flat_payout amounts as inline value
 * create-inputs; the canonical award stored in the db keeps the value id.
 * Percentage awards are stored inline.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { values } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import { durationSchema } from "../../schemas/common.ts";
import type { Award } from "../../schemas/coupon.ts";
import { type Value, valueCreateSchema } from "../../schemas/value.ts";

/** The call-surface award: monetary amounts are inline value create-inputs. */
export const awardApiSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("flat_discount"),
    value: valueCreateSchema,
    duration: durationSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("flat_payout"),
    value: valueCreateSchema,
    duration: durationSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("percentage_discount"),
    percentage: z.number().gt(0).lte(100),
    duration: durationSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("percentage_payout"),
    percentage: z.number().positive(),
    duration: durationSchema.nullable().optional(),
  }),
]);
export type AwardApi = z.infer<typeof awardApiSchema>;

/** Mint and store the award's value, returning the canonical (value-id) award. */
export async function resolveAward(award: AwardApi): Promise<Award> {
  if (
    award.type === "percentage_discount" ||
    award.type === "percentage_payout"
  ) {
    return { ...award, duration: award.duration ?? null };
  }
  const valueId = generateId({ prefix: "value" });
  await db
    .insert(values)
    .values({
      ...award.value,
      valueId,
      createdAt: Date.now(),
      deprecatedAt: null,
    })
    .onConflictDoNothing();
  return {
    type: award.type,
    valueId,
    duration: award.duration ?? null,
  };
}

/** Expand a stored award's value id back into the full value object. */
export async function expandAward(award: Award): Promise<AwardApi> {
  if (
    award.type === "percentage_discount" ||
    award.type === "percentage_payout"
  ) {
    return award;
  }
  const [value] = await db
    .select()
    .from(values)
    .where(eq(values.valueId, award.valueId));
  // Award values are always stored by resolveAward, so the row exists.
  return {
    type: award.type,
    value: value as Value,
    duration: award.duration,
  };
}
