import type { loans } from "../../../db/schema.ts";
import type { CurrencyAmount, Duration } from "../../../schemas/common.ts";
import type { Installment } from "../../../schemas/installment.ts";
import {
  annualInterestPercentageSchema,
  loanAmountSchema,
  loanServicingStateSchema,
  loanServicingTermsSchema,
  PERCENTAGE_SCALE,
  type LoanServicingTerms,
} from "../../../schemas/loan-servicing.ts";

export const DAY_MS = 86_400_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const PERCENTAGE_DENOMINATOR = 100n * BigInt(PERCENTAGE_SCALE);

export class LoanServicingError extends Error {
  readonly code:
    | "invalid_input"
    | "not_enabled"
    | "deleted"
    | "closed"
    | "backdated"
    | "overpayment"
    | "invalid_state";
  readonly status: 400 | 409;

  constructor({
    code,
    message,
  }: {
    code: LoanServicingError["code"];
    message: string;
  }) {
    super(message);
    this.name = "LoanServicingError";
    this.code = code;
    this.status =
      code === "invalid_input" || code === "overpayment" ? 400 : 409;
  }
}

export function calendarDeadline({
  anchorAt,
  duration,
  period = 1,
}: {
  anchorAt: number;
  duration: Duration;
  period?: number;
}): number {
  const date = new Date(anchorAt);
  if (duration.days !== null) {
    date.setUTCDate(date.getUTCDate() + duration.days * period);
  } else {
    const day = date.getUTCDate();
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
    throw new LoanServicingError({
      code: "invalid_input",
      message: "unrepresentable calendar deadline",
    });
  }
  return deadline;
}

function percentageUnits({ percentage }: { percentage: number }): bigint {
  const [whole, fraction = ""] = String(percentage).split(".");
  return (
    BigInt(whole) * BigInt(PERCENTAGE_SCALE) + BigInt(fraction.padEnd(6, "0"))
  );
}

function money({ value }: { value: bigint }): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new LoanServicingError({
      code: "invalid_state",
      message: "loan balance exceeds safe integer range",
    });
  }
  return Number(value);
}

export function minimumAmount({
  balance,
  repayment,
}: {
  balance: number;
  repayment: Extract<
    LoanServicingTerms["repayment"],
    { type: "periodic_minimum" }
  >;
}): number {
  const minimum = repayment.minimum;
  if (minimum.type === "fixed") {
    return Math.min(balance, minimum.amount.value);
  }
  const numerator =
    BigInt(balance) * percentageUnits({ percentage: minimum.percentage });
  const percentageAmount = money({
    value: (numerator + PERCENTAGE_DENOMINATOR - 1n) / PERCENTAGE_DENOMINATOR,
  });
  return Math.min(balance, Math.max(minimum.floor.value, percentageAmount));
}

export type LoanRow = typeof loans.$inferSelect;
export type LoanAction =
  | { type: "service" }
  | { type: "payment"; amount: CurrencyAmount }
  | { type: "reversal"; interestAmount: number; principalAmount: number };

/** A computed repayment obligation: not a row, derived at calculation time. */
export type LoanDue = { amount: number; dueAt: number };

/* This transition is pure: all validation and calculation finish before the
 * transaction adapter writes anything. Installment rows earmark debt, never
 * add it; minimums and the maturity balance are computed, never materialized. */
export function calculateLoan({
  action,
  at,
  installments,
  loan,
}: {
  action: LoanAction;
  at: number;
  installments: Installment[];
  loan: LoanRow;
}) {
  if (!loan.servicingTerms || !loan.servicingState) {
    throw new LoanServicingError({
      code: "not_enabled",
      message: "legacy loan servicing is disabled",
    });
  }
  if (loan.deletedAt !== null) {
    throw new LoanServicingError({
      code: "deleted",
      message: "deleted loans cannot be serviced or settled",
    });
  }
  if (!Number.isSafeInteger(at) || at < 0 || at > MAX_DATE_MS) {
    throw new LoanServicingError({
      code: "invalid_input",
      message: "invalid settlement timestamp",
    });
  }
  const termsResult = loanServicingTermsSchema.safeParse(loan.servicingTerms);
  const stateResult = loanServicingStateSchema.safeParse(loan.servicingState);
  if (
    !termsResult.success ||
    !stateResult.success ||
    !annualInterestPercentageSchema.safeParse(loan.annualInterestPercentage)
      .success
  ) {
    throw new LoanServicingError({
      code: "invalid_state",
      message: "invalid persisted servicing terms or state",
    });
  }
  const terms = termsResult.data;
  const state = stateResult.data;
  if (at < state.checkpointAt || at < loan.createdAt) {
    throw new LoanServicingError({
      code: "backdated",
      message:
        "settlement precedes servicing checkpoint; retry with current settlement time",
    });
  }
  if (loan.closedAt !== null && action.type === "payment") {
    throw new LoanServicingError({
      code: "closed",
      message: "loan is already paid off",
    });
  }
  if (
    action.type === "payment" &&
    (!loanAmountSchema.safeParse(action.amount).success ||
      action.amount.currency !== loan.principal.currency ||
      action.amount.unit !== loan.principal.unit)
  ) {
    throw new LoanServicingError({
      code: "invalid_input",
      message:
        "payment must use the loan currency/unit and a positive integer amount",
    });
  }
  if (
    action.type === "reversal" &&
    (!Number.isSafeInteger(action.principalAmount) ||
      action.principalAmount < 0 ||
      !Number.isSafeInteger(action.interestAmount) ||
      action.interestAmount < 0 ||
      BigInt(action.principalAmount) + BigInt(action.interestAmount) <= 0n ||
      BigInt(state.principalAmount) + BigInt(action.principalAmount) >
        BigInt(loan.principal.value))
  ) {
    throw new LoanServicingError({
      code: "invalid_input",
      message: "invalid refund allocation",
    });
  }
  const current: LoanRow = { ...loan, servicingState: state };
  const obligations = installments
    .map((row) => ({ ...row, amount: { ...row.amount } }))
    .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
  const generated: Omit<Installment, "installmentId">[] = [];
  const all = [...obligations, ...generated];
  let allocation = { principalAmount: 0, interestAmount: 0 };
  if (loan.closedAt !== null && action.type === "service") {
    return {
      allocation,
      due: [],
      generated,
      installments: obligations,
      loan: current,
    };
  }
  const denominator =
    PERCENTAGE_DENOMINATOR *
    BigInt(terms.interest.dayCount === "actual_365" ? 365 : 360) *
    BigInt(DAY_MS);
  if (BigInt(state.interestCarry) >= denominator) {
    throw new LoanServicingError({
      code: "invalid_state",
      message: "invalid fractional interest carry",
    });
  }
  const payoff = () =>
    money({
      value: BigInt(state.principalAmount) + BigInt(state.interestAmount),
    });
  const unpaid = () =>
    all.reduce(
      (total, row) =>
        total +
        (row.canceledAt === null
          ? BigInt(row.amount.value) - BigInt(row.allocatedAmount ?? 0)
          : 0n),
      0n,
    );
  const accrue = ({ through }: { through: number }) => {
    const cutoff =
      terms.interest.postMaturity === "stop"
        ? Math.min(through, loan.endsAt)
        : through;
    const elapsed = Math.max(0, cutoff - state.checkpointAt);
    const basis =
      terms.interest.basis === "original_principal"
        ? loan.principal.value
        : state.principalAmount;
    const numerator =
      BigInt(basis) *
        percentageUnits({ percentage: loan.annualInterestPercentage }) *
        BigInt(elapsed) +
      BigInt(state.interestCarry);
    state.interestAmount = money({
      value: BigInt(state.interestAmount) + numerator / denominator,
    });
    state.interestCarry = String(numerator % denominator);
    state.checkpointAt = through;
    payoff();
  };
  if (loan.closedAt === null) {
    accrue({ through: at });
  } else {
    // Refunding a payoff reopens at settlement, never accruing across the closed interval.
    state.checkpointAt = at;
  }
  if (action.type === "payment") {
    if (action.amount.value > payoff()) {
      throw new LoanServicingError({
        code: "overpayment",
        message: "payment exceeds loan payoff",
      });
    }
    const interestAmount =
      terms.allocation === "interest_first"
        ? Math.min(action.amount.value, state.interestAmount)
        : Math.max(0, action.amount.value - state.principalAmount);
    const principalAmount = action.amount.value - interestAmount;
    const payingOff = action.amount.value === payoff();
    state.principalAmount -= principalAmount;
    state.interestAmount -= interestAmount;
    allocation = { interestAmount, principalAmount };
    let credit = action.amount.value;
    for (const row of all) {
      if (
        row.canceledAt !== null ||
        credit === 0 ||
        (payingOff && row.dueAt > at)
      ) {
        continue;
      }
      const applied = Math.min(
        credit,
        row.amount.value - (row.allocatedAmount ?? 0),
      );
      row.allocatedAmount = (row.allocatedAmount ?? 0) + applied;
      credit -= applied;
      if (applied > 0 && row.allocatedAmount === row.amount.value) {
        row.paidAt = at;
      }
    }
    if (payoff() === 0) {
      current.closedAt = at;
      // Sub-unit interest is waived on whole-unit payoff, not rounded into new debt.
      state.interestCarry = "0";
      for (const row of all) {
        if (
          row.canceledAt === null &&
          row.allocatedAmount !== row.amount.value
        ) {
          row.canceledAt = at;
        }
      }
    }
  }
  if (action.type === "reversal") {
    state.principalAmount = money({
      value: BigInt(state.principalAmount) + BigInt(action.principalAmount),
    });
    state.interestAmount = money({
      value: BigInt(state.interestAmount) + BigInt(action.interestAmount),
    });
    const amount = money({
      value: BigInt(action.principalAmount) + BigInt(action.interestAmount),
    });
    payoff();
    generated.push({
      allocatedAmount: 0,
      amount: { ...loan.principal, value: amount },
      canceledAt: null,
      createdAt: at,
      dueAt: at,
      loanId: loan.loanId,
      paidAt: null,
    });
    all.push(...generated);
    current.closedAt = null;
    allocation = {
      interestAmount: action.interestAmount,
      principalAmount: action.principalAmount,
    };
  }
  const due = computeDue({ all, at, loan: current, state, terms, unpaid });
  return {
    allocation,
    due,
    generated,
    installments: obligations,
    loan: current,
  };
}

/* Repayment obligations are derived, not stored: arrears from unpaid past-due
 * rows, the next minimum from the current balance, and the maturity remainder. */
function computeDue({
  all,
  at,
  loan,
  state,
  terms,
  unpaid,
}: {
  all: Omit<Installment, "installmentId">[];
  at: number;
  loan: LoanRow;
  state: Exclude<LoanRow["servicingState"], null>;
  terms: LoanServicingTerms;
  unpaid: () => bigint;
}): LoanDue[] {
  if (loan.closedAt !== null) {
    return [];
  }
  const due: LoanDue[] = [];
  const arrears = all
    .filter((row) => row.canceledAt === null && row.dueAt <= at)
    .reduce(
      (total, row) =>
        total + (BigInt(row.amount.value) - BigInt(row.allocatedAmount ?? 0)),
      0n,
    );
  if (arrears > 0n) {
    due.push({ amount: money({ value: arrears }), dueAt: at });
  }
  const balance = money({
    value: BigInt(state.principalAmount) + BigInt(state.interestAmount),
  });
  if (at >= loan.endsAt) {
    const remainder = money({ value: BigInt(balance) - unpaid() });
    if (remainder > 0) {
      due.push({ amount: remainder, dueAt: loan.endsAt });
    }
    return due;
  }
  if (terms.repayment.type === "periodic_minimum") {
    const period = periodAt({
      anchorAt: loan.createdAt,
      at,
      intervalMonths: terms.repayment.intervalMonths,
    });
    const nextBoundaryAt = calendarDeadline({
      anchorAt: loan.createdAt,
      duration: {
        days: null,
        months: terms.repayment.intervalMonths,
      },
      period,
    });
    const unscheduled = money({ value: BigInt(balance) - unpaid() });
    const amount = Math.min(
      unscheduled,
      minimumAmount({ balance, repayment: terms.repayment }),
    );
    if (amount > 0) {
      due.push({ amount, dueAt: nextBoundaryAt });
    }
  }
  return due;
}

const MAX_PERIOD_MONTHS = 1200;

/** The 1-based period number whose calendar deadline first falls after `at`. */
function periodAt({
  anchorAt,
  at,
  intervalMonths,
}: {
  anchorAt: number;
  at: number;
  intervalMonths: number;
}): number {
  const anchor = new Date(anchorAt);
  const now = new Date(at);
  const elapsedMonths =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    anchor.getUTCMonth();
  let period = Math.max(1, Math.floor(elapsedMonths / intervalMonths) + 1);
  /* Day-of-month clamping (e.g. Jan 31 -> Feb 29) can push the estimated
   * deadline to either side of `at`; walk to the first deadline past it. */
  for (let count = 0; count < MAX_PERIOD_MONTHS; count++) {
    const deadline = calendarDeadline({
      anchorAt,
      duration: { days: null, months: intervalMonths },
      period,
    });
    if (deadline > at) {
      return period;
    }
    period++;
  }
  throw new LoanServicingError({
    code: "invalid_state",
    message: "servicing period limit exceeded",
  });
}
