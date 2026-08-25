/**
 * v0/awards/service.ts -- award business logic. Awards have no route of
 * their own: they're composed into coupons and coupon templates. Award
 * values (for payout/flat_discount) may be existing value ids or inline
 * definitions.
 */
import { z } from "zod";
import type { Award } from "../../schemas/coupon.ts";
import { resolveValueRef, valueRefSchema } from "../value/service.ts";

/** An award whose value (for payout/flat_discount) may be inline. */
export const awardInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("payout"), value: valueRefSchema }),
  z.object({ type: z.literal("flat_discount"), value: valueRefSchema }),
  z.object({
    type: z.literal("percentage_discount"),
    value: z.number().gt(0).lte(100),
  }),
]);
export type AwardInput = z.infer<typeof awardInputSchema>;

/** Resolve an award's inline value refs to ids. */
export async function resolveAward(award: AwardInput): Promise<Award> {
  if (award.type === "percentage_discount") {
    return award;
  }
  return { type: award.type, value: await resolveValueRef(award.value) };
}
