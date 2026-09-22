import { getTableColumns, type Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paymentLoans, payments, refunds } from "../../../db/schema.ts";
import { applyLoanPayment, reverseLoanPayment } from "../loan/servicing.ts";
import { patchRefund } from "../refund/service.ts";
import { createPayment, patchPayment } from "./service.ts";

const { query, transaction, rollback } = vi.hoisted(() => ({
  query:
    vi.fn<(sql: string, params: unknown[]) => Promise<{ rows: unknown[][] }>>(),
  transaction: vi.fn<(work: () => Promise<unknown>) => Promise<unknown>>(),
  rollback: vi.fn(),
}));

// Real SQL generation and result mapping, without a database connection.
vi.mock("../../../db/index.ts", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const db = drizzle(query);
  return {
    db: {
      select: db.select.bind(db),
      transaction: (work: (tx: typeof db) => Promise<unknown>) =>
        transaction(() => work(db)),
    },
  };
});
vi.mock("../loan/servicing.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../loan/servicing.ts")>()),
  applyLoanPayment: vi.fn(),
  reverseLoanPayment: vi.fn(),
}));

const tenantId = `tenant_${"a".repeat(22)}`;
const loanId = `loan_${"a".repeat(24)}`;
const paymentId = `payment_${"a".repeat(25)}`;
const refundId = `refund_${"a".repeat(23)}`;
const amount = { currency: "USD", unit: "cents", value: 100 };
const payment = {
  createdAt: 1,
  failedAt: null,
  paymentId,
  providerInternals: {
    customerId: "customer",
    paymentId: "provider-payment",
    provider: "stripe",
  },
  startedProcessingAt: null,
  succeededAt: null,
  tenantId,
};
const settledPayment = { ...payment, succeededAt: 2 };
const paymentLoan = {
  paymentId,
  loanId,
  amount,
  principalAmount: null,
  interestAmount: null,
};
const settledPaymentLoan = {
  ...paymentLoan,
  principalAmount: 70,
  interestAmount: 30,
};
const refund = {
  amounts: [{ ...amount, value: 80 }],
  byTeamMemberId: `team_member_${"a".repeat(16)}`,
  createdAt: 1,
  failedAt: null,
  loanInterestAmount: null,
  loanPrincipalAmount: null,
  paymentId,
  reason: null,
  refundId,
  startedProcessingAt: null,
  succeededAt: null,
  tenantId,
};
const settledRefund = {
  ...refund,
  loanInterestAmount: 10,
  loanPrincipalAmount: 70,
  succeededAt: 3,
};
const paymentBody = {
  invoiceIds: [],
  loan: { amount, loanId },
  providerInternals: payment.providerInternals,
};

function row({ data, table }: { data: Record<string, unknown>; table: Table }) {
  return Object.keys(getTableColumns(table)).map((key) => data[key]);
}
const paymentRow = row({ data: payment, table: payments });
const settledPaymentRow = row({ data: settledPayment, table: payments });
const paymentLoanRow = row({ data: paymentLoan, table: paymentLoans });
const settledPaymentLoanRow = row({
  data: settledPaymentLoan,
  table: paymentLoans,
});
const refundRow = row({ data: refund, table: refunds });
const settledRefundRow = row({ data: settledRefund, table: refunds });

beforeEach(() => {
  vi.restoreAllMocks();
  query.mockReset().mockRejectedValue(new Error("unexpected query"));
  rollback.mockReset();
  transaction.mockReset().mockImplementation(async (work) => {
    try {
      return await work();
    } catch (error) {
      rollback(error);
      throw error;
    }
  });
  vi.mocked(applyLoanPayment)
    .mockReset()
    .mockResolvedValue({ interestAmount: 30, principalAmount: 70 });
  vi.mocked(reverseLoanPayment)
    .mockReset()
    .mockResolvedValue({ interestAmount: 10, principalAmount: 70 });
});

describe("repayment integration (isolated)", () => {
  it("settles a payment once, locks the tenant loan before taking the timestamp, and persists splits atomically", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(3);
    query
      .mockResolvedValueOnce({ rows: [paymentRow] })
      .mockResolvedValueOnce({ rows: [paymentLoanRow] })
      .mockImplementationOnce(async () => {
        expect(now).not.toHaveBeenCalled();
        return { rows: [[loanId]] };
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [settledPaymentRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [settledPaymentLoanRow] })
      .mockResolvedValueOnce({ rows: [settledPaymentRow] })
      .mockResolvedValueOnce({ rows: [paymentLoanRow] })
      .mockResolvedValueOnce({ rows: [settledPaymentRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [settledPaymentLoanRow] });
    const input = {
      patch: { event: "succeeded" as const },
      paymentId,
      tenantId,
    };
    expect(await patchPayment(input)).toMatchObject({
      loan: { interestAmount: 30, principalAmount: 70 },
    });
    await patchPayment(input);
    expect(applyLoanPayment).toHaveBeenCalledExactlyOnceWith({
      amount,
      at: 3,
      loanId,
      tenantId,
      tx: expect.anything(),
    });
    expect(query.mock.calls[0][0]).toContain('"payments"."tenant_id"');
    expect(query.mock.calls[0][0]).toContain("for update");
    expect(query.mock.calls[2][1]).toEqual([loanId, tenantId]);
    expect(query.mock.calls[3][0]).toMatch(
      /update "payment_loans".*"principal_amount".*"interest_amount"/,
    );
    expect(rollback).not.toHaveBeenCalled();
  });

  it("deduplicates loan creates under the loan lock and rejects a changed amount", async () => {
    query
      .mockResolvedValueOnce({ rows: [[amount]] })
      .mockResolvedValueOnce({ rows: [paymentRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [paymentLoanRow] })
      .mockResolvedValueOnce({ rows: [[amount]] })
      .mockResolvedValueOnce({ rows: [paymentRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [paymentLoanRow] });
    expect(
      await createPayment({ payment: paymentBody, tenantId }),
    ).toMatchObject({ paymentId });
    await expect(
      createPayment({
        payment: {
          ...paymentBody,
          loan: { loanId, amount: { ...amount, value: 99 } },
        },
        tenantId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls[0][0]).toContain("for update");
    expect(query.mock.calls[1][1]).toEqual([
      tenantId,
      "stripe",
      "provider-payment",
    ]);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("insert"))).toBe(
      false,
    );
  });

  it("reverses principal then interest once and locks payment before refund before loan", async () => {
    for (const rows of [
      [refundRow],
      [settledPaymentRow],
      [refundRow],
      [settledPaymentLoanRow],
      [],
      [settledPaymentLoanRow],
      [[loanId]],
      [],
      [settledRefundRow],
      [settledRefundRow],
      [settledPaymentRow],
      [settledRefundRow],
      [settledRefundRow],
    ]) {
      query.mockResolvedValueOnce({ rows });
    }
    const input = {
      patch: { event: "succeeded" as const },
      refundId,
      tenantId,
    };
    expect(await patchRefund(input)).toMatchObject({
      loanPrincipalAmount: 70,
      loanInterestAmount: 10,
    });
    await patchRefund(input);
    expect(reverseLoanPayment).toHaveBeenCalledExactlyOnceWith({
      at: expect.any(Number),
      interestAmount: 10,
      loanId,
      principalAmount: 70,
      tenantId,
      tx: expect.anything(),
    });
    const locks = query.mock.calls.filter(([sql]) =>
      sql.includes("for update"),
    );
    expect(
      locks.slice(0, 3).map(([sql]) => sql.match(/from "(\w+)"/)?.[1]),
    ).toEqual(["payments", "refunds", "loans"]);
    expect(query.mock.calls[4][0]).toContain(
      '"refunds"."succeeded_at" is not null',
    );
    expect(query.mock.calls[4][1]).toEqual([paymentId, tenantId]);
  });

  it.each(["payment", "refund"])(
    "rolls back %s bridge effects if the settlement stamp fails",
    async (resource) => {
      const error = new Error("write failed");
      const responses =
        resource === "payment"
          ? [[paymentRow], [paymentLoanRow], [[loanId]]]
          : [
              [refundRow],
              [settledPaymentRow],
              [refundRow],
              [settledPaymentLoanRow],
              [],
              [settledPaymentLoanRow],
              [[loanId]],
            ];
      for (const rows of responses) {
        query.mockResolvedValueOnce({ rows });
      }
      query.mockRejectedValueOnce(error);
      await expect(
        resource === "payment"
          ? patchPayment({ patch: { event: "succeeded" }, paymentId, tenantId })
          : patchRefund({ patch: { event: "succeeded" }, refundId, tenantId }),
      ).rejects.toThrow();
      expect(
        resource === "payment" ? applyLoanPayment : reverseLoanPayment,
      ).toHaveBeenCalledOnce();
      expect(rollback).toHaveBeenCalledOnce();
    },
  );
});
