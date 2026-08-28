/**
 * v0/award/service.ts -- award business logic. Awards have no route of
 * their own: they're composed into coupons and coupon templates. The call
 * surface passes payout/flat_discount amounts as full value objects; the
 * canonical award stored in the db keeps the value id.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { values } from "../../db/schema.ts";
import type { Award } from "../../schemas/coupon.ts";
import { valueSchema, type Value } from "../../schemas/value.ts";

/** The call-surface award: monetary amounts are full inline values. */
export const awardApiSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("payout"), value: valueSchema }),
  z.object({ type: z.literal("flat_discount"), value: valueSchema }),
  z.object({
    type: z.literal("percentage_discount"),
    percentage: z.number().gt(0).lte(100),
  }),
]);
export type AwardApi = z.infer<typeof awardApiSchema>;

/** Store the award's value, returning the canonical (value-id) award. */
export async function resolveAward(award: AwardApi): Promise<Award> {
  if (award.type === "percentage_discount") {
    return award;
  }
  await db.insert(values).values(award.value).onConflictDoNothing();
  return { type: award.type, valueId: award.value.valueId };
}

/** Expand a stored award's value id back into the full value object. */
export async function expandAward(award: Award): Promise<AwardApi> {
  if (award.type === "percentage_discount") {
    return award;
  }
  const [value] = await db
    .select()
    .from(values)
    .where(eq(values.valueId, award.valueId));
  // Award values are always stored by resolveAward, so the row exists.
  return { type: award.type, value: value as Value };
}
