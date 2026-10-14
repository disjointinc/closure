/**
 * lib/calendar.ts -- calendar arithmetic, in UTC so a time of day carries
 * over unchanged.
 *
 * Billing period boundaries are whole cycles counted from a billing anchor:
 * day cycles are exact, and month cycles keep the anchor's day of the
 * month, clamped to the month's last day (an anchor on Jan 31 gives Feb 28
 * or 29, then Mar 31), the way Stripe counts billing dates.
 *
 * Deadlines (loan terms, invoice credit periods) instead treat an anchor on
 * a month's last day as "the last day of the month" (addDurations).
 */
import type { Duration } from "../schemas/common.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** anchorAt plus count whole cycles; count may be negative. */
export function addCycles({
  anchorAt,
  count,
  cycleLength,
}: {
  anchorAt: number;
  count: number;
  cycleLength: Duration;
}): number {
  if (cycleLength.days !== null) {
    return anchorAt + count * cycleLength.days * MS_PER_DAY;
  }
  if (cycleLength.months === null) {
    throw new Error("a cycle length needs days or months");
  }
  const anchor = new Date(anchorAt);
  const boundary = new Date(anchorAt);
  // Day 1 first, so moving the month can't spill into the month after.
  boundary.setUTCDate(1);
  boundary.setUTCMonth(anchor.getUTCMonth() + count * cycleLength.months);
  const lastDay = new Date(
    Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0),
  ).getUTCDate();
  boundary.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return boundary.getTime();
}

/** The billing period [periodStart, periodEnd) that contains `at`. */
export function billingPeriodAt({
  anchorAt,
  at,
  cycleLength,
}: {
  anchorAt: number;
  at: number;
  cycleLength: Duration;
}): { periodEnd: number; periodStart: number } {
  if ((cycleLength.days ?? cycleLength.months ?? 0) <= 0) {
    throw new Error("a cycle length must be positive");
  }
  const anchor = new Date(anchorAt);
  const moment = new Date(at);
  const calendarMonths =
    (moment.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    moment.getUTCMonth() -
    anchor.getUTCMonth();
  /* Day cycles are a fixed length, so dividing gives the exact answer.
   * Rounding down is safe from floating point error: `at`, `anchorAt` and
   * the cycle length are whole milliseconds, and dividing two whole numbers
   * below Number.MAX_SAFE_INTEGER never lands on the wrong side of a whole
   * number (an exact multiple divides to exactly that whole number, never
   * to a hair under it).
   *
   * Month cycles count calendar months from the anchor's month to the month
   * `at` is in, ignoring the day of the month. That count can only be wrong
   * in one way: `at` is in a month that has a billing period boundary, but
   * `at` comes before that boundary. For example, with an anchor on Jan 15
   * and `at` on Mar 10, counting months says 2 cycles have passed, but the
   * Mar 15 boundary hasn't happened yet, so only 1 has. `count` below checks
   * for this and steps back one cycle.
   *
   * It can never be wrong by more than one cycle because a boundary always
   * stays in its own calendar month (an anchor on Jan 31 gives Feb 28, never
   * Mar 3). */
  const guess =
    cycleLength.days !== null
      ? Math.floor((at - anchorAt) / (cycleLength.days * MS_PER_DAY))
      : Math.floor(calendarMonths / (cycleLength.months ?? 0));
  const count =
    at < addCycles({ anchorAt, count: guess, cycleLength }) ? guess - 1 : guess;
  const periodStart = addCycles({ anchorAt, count, cycleLength });
  const periodEnd = addCycles({ anchorAt, count: count + 1, cycleLength });
  if (at < periodStart || at >= periodEnd) {
    throw new Error(
      `no billing period found for ${at} from anchor ${anchorAt}`,
    );
  }
  return { periodEnd, periodStart };
}

/**
 * anchorAt plus `period` durations. Months land on the anchor's day of the
 * month, clamped to the month's last day; an anchor on a month's last day
 * lands on each later month's last day. Null when the answer isn't a safe
 * integer after the anchor.
 */
export function addDurations({
  anchorAt,
  duration,
  period = 1,
}: {
  anchorAt: number;
  duration: Duration;
  period?: number;
}): number | null {
  const date = new Date(anchorAt);
  if (duration.days !== null) {
    date.setUTCDate(date.getUTCDate() + duration.days * period);
  } else {
    const day = date.getUTCDate();
    /* Day 0 of a month is the last day of the month before it, so each
     * "+ 1, 0" below lands on the last day of the month we want rather than
     * adding an extra month. Going through the last day avoids overflow:
     * setting Jan 31 straight to February would give Mar 3. */
    const lastDay = new Date(anchorAt);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    const endOfMonth = day === lastDay.getUTCDate();
    date.setUTCMonth(
      date.getUTCMonth() + (duration.months ?? 0) * period + 1,
      0,
    );
    if (!endOfMonth) {
      date.setUTCDate(Math.min(day, date.getUTCDate()));
    }
  }
  const deadline = date.getTime();
  if (!Number.isSafeInteger(deadline) || deadline <= anchorAt) {
    return null;
  }
  return deadline;
}
