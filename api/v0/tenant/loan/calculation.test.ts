import { describe, expect, it } from "vitest";
import type { Installment } from "../../../schemas/installment.ts";
import type { LoanServicingTerms } from "../../../schemas/loan-servicing.ts";
import {
  calculateLoan,
  calendarDeadline,
  DAY_MS,
  LoanServicingError,
  type LoanRow,
} from "./calculation.ts";

const createdAt = Date.parse("2024-01-31T12:34:56.789Z");
const principal = { currency: "USD", unit: "cents", value: 100_000 };
const terms: LoanServicingTerms = {
  allocation: "interest_first",
  interest: {
    basis: "outstanding_principal",
    calculation: "simple",
    dayCount: "actual_365",
    postMaturity: "stop",
  },
  repayment: { type: "maturity_only" },
};

function makeLoan({
  rate = 12.5,
  servicingTerms = terms,
  value = principal.value,
}: {
  rate?: number;
  servicingTerms?: LoanServicingTerms;
  value?: number;
} = {}): LoanRow {
  const endsAt = createdAt + 365 * DAY_MS;
  return {
    annualInterestPercentage: rate,
    assignmentId: null,
    closedAt: null,
    createdAt,
    deletedAt: null,
    duration: { days: 365, months: null },
    endsAt,
    loanId: `loan_${"a".repeat(24)}`,
    loanTemplateId: null,
    principal: { ...principal, value },
    servicingState: {
      checkpointAt: createdAt,
      interestAmount: 0,
      interestCarry: "0",
      principalAmount: value,
    },
    servicingTerms,
    tenantId: `tenant_${"a".repeat(22)}`,
  };
}

function savedInstallments({
  result,
}: {
  result: ReturnType<typeof calculateLoan>;
}): Installment[] {
  return [
    ...result.installments,
    ...result.generated.map((row, index) => ({
      ...row,
      installmentId: `installment_${String(index).padStart(25, "0")}`,
    })),
  ];
}

describe("exact fixed-principal calculations", () => {
  it.each([
    { dayCount: "actual_365", days: 365 },
    { dayCount: "actual_360", days: 360 },
  ] as const)(
    "earns the exact annual rate with $dayCount",
    ({ dayCount, days }) => {
      const loan = makeLoan({
        servicingTerms: { ...terms, interest: { ...terms.interest, dayCount } },
      });
      const result = calculateLoan({
        action: { type: "service" },
        at: createdAt + days * DAY_MS,
        installments: [],
        loan,
      });
      expect(result.loan.servicingState?.interestAmount).toBe(12_500);
      expect(result.loan.servicingState?.interestCarry).toBe("0");
    },
  );
  it("preserves exact fractional carry across arbitrary checkpoint splits", () => {
    const loan = makeLoan({ rate: 1.234567 });
    const first = calculateLoan({
      action: { type: "service" },
      at: createdAt + 1,
      installments: [],
      loan,
    });
    const split = calculateLoan({
      action: { type: "service" },
      at: loan.endsAt,
      installments: [],
      loan: first.loan,
    });
    const whole = calculateLoan({
      action: { type: "service" },
      at: loan.endsAt,
      installments: [],
      loan,
    });
    expect(split.loan.servicingState).toEqual(whole.loan.servicingState);
    expect(whole.loan.servicingState?.interestAmount).toBe(1234);
    expect(whole.loan.servicingState?.interestCarry).not.toBe("0");
  });
  it.each([
    { basis: "outstanding_principal", interest: 7500 },
    { basis: "original_principal", interest: 10000 },
  ] as const)(
    "uses $basis after partial principal repayment",
    ({ basis, interest }) => {
      const loan = makeLoan({
        rate: 10,
        servicingTerms: {
          ...terms,
          allocation: "principal_first",
          interest: { ...terms.interest, basis },
        },
      });
      const paid = calculateLoan({
        action: { amount: { ...principal, value: 50_000 }, type: "payment" },
        at: createdAt + (365 * DAY_MS) / 2,
        installments: [],
        loan,
      });
      expect(paid.allocation).toEqual({
        interestAmount: 0,
        principalAmount: 50_000,
      });
      const result = calculateLoan({
        action: { type: "service" },
        at: loan.endsAt,
        installments: [],
        loan: paid.loan,
      });
      expect(result.loan.servicingState?.interestAmount).toBe(interest);
      expect(result.loan.principal).toEqual(principal);
    },
  );
  it.each([
    { postMaturity: "stop", interest: 10000 },
    { postMaturity: "accrue", interest: 20000 },
  ] as const)(
    "applies late cutoff $postMaturity without compounding",
    ({ postMaturity, interest }) => {
      const loan = makeLoan({
        rate: 10,
        servicingTerms: {
          ...terms,
          interest: { ...terms.interest, postMaturity },
        },
      });
      const result = calculateLoan({
        action: { type: "service" },
        at: createdAt + 730 * DAY_MS,
        installments: [],
        loan,
      });
      expect(result.loan.servicingState?.interestAmount).toBe(interest);
      expect(result.generated).toHaveLength(0);
      expect(result.due).toEqual([
        { amount: principal.value + interest, dueAt: loan.endsAt },
      ]);
    },
  );
  it.each([
    {
      allocation: "interest_first",
      interestAmount: 10_000,
      principalAmount: 5000,
    },
    {
      allocation: "principal_first",
      interestAmount: 0,
      principalAmount: 15_000,
    },
  ] as const)(
    "honors $allocation allocation",
    ({ allocation, interestAmount, principalAmount }) => {
      const loan = makeLoan({
        rate: 10,
        servicingTerms: { ...terms, allocation },
      });
      const result = calculateLoan({
        action: { amount: { ...principal, value: 15_000 }, type: "payment" },
        at: loan.endsAt,
        installments: [],
        loan,
      });
      expect(result.allocation).toEqual({ interestAmount, principalAmount });
      expect(result.generated).toEqual([]);
    },
  );
  it("does not mutate inputs when rejecting overpayment, currency mismatch, or backdating", () => {
    const loan = makeLoan();
    const before = structuredClone(loan);
    for (const amount of [
      { ...principal, value: 200_000 },
      { ...principal, currency: "EUR" },
      { ...principal, unit: "dollars" },
    ]) {
      expect(() =>
        calculateLoan({
          action: { amount, type: "payment" },
          at: loan.endsAt,
          installments: [],
          loan,
        }),
      ).toThrow(LoanServicingError);
      expect(loan).toEqual(before);
    }
    expect(() =>
      calculateLoan({
        action: { type: "service" },
        at: createdAt - 1,
        installments: [],
        loan,
      }),
    ).toThrow("precedes servicing checkpoint");
  });
});

describe("calendar deadlines and obligations", () => {
  it("uses UTC calendar days across leap day", () => {
    expect(
      calendarDeadline({
        anchorAt: Date.parse("2024-02-28T12:00:00Z"),
        duration: { days: 2, months: null },
      }),
    ).toBe(Date.parse("2024-03-01T12:00:00Z"));
  });
  it("credits oldest obligations first and makes the maturity remainder due", () => {
    const repayment: Extract<
      LoanServicingTerms["repayment"],
      { type: "periodic_minimum" }
    > = {
      type: "periodic_minimum",
      intervalMonths: 1,
      minimum: { type: "fixed", amount: { ...principal, value: 100 } },
    };
    const loan = makeLoan({
      rate: 0,
      servicingTerms: { ...terms, repayment },
      value: 1000,
    });
    const installments: Installment[] = [
      {
        installmentId: "installment_a",
        loanId: loan.loanId,
        createdAt,
        dueAt: calendarDeadline({
          anchorAt: createdAt,
          duration: { days: null, months: 1 },
          period: 1,
        }),
        amount: { ...principal, value: 100 },
        allocatedAmount: 0,
        paidAt: null,
        canceledAt: null,
      },
      {
        installmentId: "installment_b",
        loanId: loan.loanId,
        createdAt,
        dueAt: calendarDeadline({
          anchorAt: createdAt,
          duration: { days: null, months: 1 },
          period: 2,
        }),
        amount: { ...principal, value: 100 },
        allocatedAmount: 0,
        paidAt: null,
        canceledAt: null,
      },
    ];
    const at = calendarDeadline({
      anchorAt: createdAt,
      duration: { days: null, months: 1 },
      period: 2,
    });
    const result = calculateLoan({
      action: { amount: { ...principal, value: 150 }, type: "payment" },
      at,
      installments,
      loan,
    });
    expect(result.installments.map((row) => row.allocatedAmount)).toEqual([
      100, 50,
    ]);
    expect(result.installments[0].paidAt).toBe(at);
    expect(result.installments[1].paidAt).toBeNull();
    const maturity = calculateLoan({
      action: { type: "service" },
      at: loan.endsAt,
      installments: savedInstallments({ result }),
      loan: result.loan,
    });
    expect(maturity.due).toEqual([
      { amount: 50, dueAt: loan.endsAt },
      { amount: 800, dueAt: loan.endsAt },
    ]);
  });
});

describe("reversals", () => {
  it("restores exact components at refund settlement without interest across a closed interval", () => {
    const loan = makeLoan({ rate: 10 });
    const paid = calculateLoan({
      action: { amount: { ...principal, value: 110_000 }, type: "payment" },
      at: loan.endsAt,
      installments: [],
      loan,
    });
    const at = loan.endsAt + 30 * DAY_MS;
    const reversed = calculateLoan({
      action: { interestAmount: 1000, principalAmount: 5000, type: "reversal" },
      at,
      installments: savedInstallments({ result: paid }),
      loan: paid.loan,
    });
    expect(reversed.loan.closedAt).toBeNull();
    expect(reversed.loan.servicingState).toMatchObject({
      checkpointAt: at,
      interestAmount: 1000,
      principalAmount: 5000,
    });
    expect(reversed.generated[0]).toMatchObject({
      amount: { ...principal, value: 6000 },
      dueAt: at,
    });
    expect(reversed.due).toEqual([{ amount: 6000, dueAt: at }]);
  });
});
