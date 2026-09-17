/**
 * lib/credits.ts -- the call surface's credit denomination. Internally
 * everything (schemas, services, db, cache) speaks integer microcredits;
 * routes alone present fractional credits (1 credit = 1e6 microcredits),
 * rounding to the nearest millionth on the way in.
 */
import { z } from "zod";

export const MICROCREDITS_PER_CREDIT = 1_000_000;

/**
 * A credit quantity on the wire: fractional, rounded to the nearest
 * millionth (one microcredit) at the boundary. Refine sign per usage site.
 */
export const credits = z.number();

/**
 * Positive credits that survive rounding: sub-millionth amounts round to
 * zero microcredits and are rejected here rather than hitting db checks.
 */
export const creditsPositive = credits.refine(
  (value) => creditsToMicrocredits({ credits: value }) > 0,
  "must be at least 0.000001",
);

export function creditsToMicrocredits({
  credits,
}: {
  credits: number;
}): number {
  return Math.round(credits * MICROCREDITS_PER_CREDIT);
}

export function microcreditsToCredits({
  microcredits,
}: {
  microcredits: number;
}): number {
  return microcredits / MICROCREDITS_PER_CREDIT;
}

type ZodIssue = Exclude<Parameters<z.RefinementCtx["addIssue"]>[0], string>;

/**
 * Rewrite a validation issue raised against the internal (microcredits)
 * shape so it reads in the wire's credit names -- shared checks like
 * checkPlanMeter / checkRule run post-conversion but must not leak the
 * internal denomination in their messages.
 */
export function renameIssueToCredits({ issue }: { issue: ZodIssue }): ZodIssue {
  const rename = (text: string) =>
    text
      .replaceAll("microcredits_", "credits_")
      .replaceAll("Microcredits", "Credits");
  return {
    ...issue,
    message: issue.message === undefined ? undefined : rename(issue.message),
    path: issue.path?.map((segment) =>
      typeof segment === "string" ? rename(segment) : segment,
    ),
  };
}
