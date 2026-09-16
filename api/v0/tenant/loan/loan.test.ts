import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/index.ts";
import {
  loanApiSchema,
  loanApp,
  type LoanApi,
  type LoanCreateBody,
} from "./routes.ts";
import { applyLoanPayment } from "./servicing.ts";

const { query, transaction } = vi.hoisted(() => ({
  query:
    vi.fn<(sql: string, params: unknown[]) => Promise<{ rows: unknown[][] }>>(),
  transaction:
    vi.fn<
      (work: () => Promise<unknown>, options?: unknown) => Promise<unknown>
    >(),
}));

/* Generate real SQL and map responses without opening any database connection.
 * Only the transaction callback receives an insert-capable database. */
vi.mock("../../../db/index.ts", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const db = drizzle(query);
  return {
    db: {
      select: db.select.bind(db),
      transaction: (
        work: (tx: typeof db) => Promise<unknown>,
        options?: unknown,
      ) => transaction(() => work(db), options),
      update: db.update.bind(db),
    },
  };
});

const tenantId = `tenant_${"a".repeat(22)}`;
const otherTenantId = `tenant_${"b".repeat(22)}`;
const loanId = `loan_${"a".repeat(24)}`;
const installmentId = `installment_${"a".repeat(25)}`;
const loanTemplateId = `loan_template_${"a".repeat(20)}`;
const createdAt = Date.parse("2026-01-31T12:34:56.789Z");
const endsAt = Date.parse("2026-02-28T12:34:56.789Z");
const amount = { currency: "USD", unit: "cents", value: 100 };
const body: LoanCreateBody = {
  assignmentId: null,
  duration: { days: null, months: 1 },
  installments: [{ amount, dueAt: endsAt }],
  annualInterestPercentage: 1,
  loanTemplateId: null,
  principal: amount,
  servicingTerms: {
    allocation: "interest_first",
    interest: {
      basis: "outstanding_principal",
      calculation: "simple",
      dayCount: "actual_365",
      postMaturity: "stop",
    },
    repayment: { type: "fixed_schedule" },
  },
};
const loan: LoanApi = {
  ...body,
  closedAt: null,
  createdAt,
  due: [],
  writeOff: null,
  endsAt,
  installments: [
    {
      amount,
      createdAt,
      dueAt: endsAt,
      installmentId,
      loanId,
      paidAt: null,
      allocatedAmount: 0,
      canceledAt: null,
    },
  ],
  loanId,
  tenantId,
  servicingState: {
    checkpointAt: createdAt,
    interestAmount: 0,
    interestCarry: "0",
    principalAmount: amount.value,
  },
};

const app = new Hono<{ Variables: { tenantId: string } }>()
  .use("/v0/tenant/:tenantId/*", async (c, next) => {
    c.set("tenantId", c.req.param("tenantId"));
    await next();
  })
  .route("/v0/tenant/:tenantId/loan", loanApp);
const basePath = `/v0/tenant/${tenantId}/loan`;

function queueLoan({
  result = loan,
  writeOffId = null,
}: {
  result?: LoanApi;
  writeOffId?: string | null;
} = {}) {
  query.mockResolvedValueOnce({
    rows: [
      [
        result.loanId,
        result.tenantId,
        result.assignmentId,
        result.createdAt,
        result.closedAt,
        writeOffId,
        result.endsAt,
        result.loanTemplateId,
        result.principal,
        result.annualInterestPercentage,
        result.servicingTerms,
        result.servicingState,
        result.duration,
      ],
    ],
  });
  query.mockResolvedValueOnce({
    rows: result.installments.map((installment) => [
      installment.installmentId,
      installment.loanId,
      installment.createdAt,
      installment.dueAt,
      installment.amount,
      installment.paidAt,
      installment.allocatedAmount,
      installment.canceledAt,
    ]),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  query.mockReset().mockRejectedValue(new Error("unexpected database query"));
  transaction.mockReset().mockImplementation((work) => work());
  vi.spyOn(Date, "now").mockReturnValue(createdAt);
});

describe("loan routes and service (isolated)", () => {
  it.each([
    { method: "GET", path: loanId },
    { method: "PATCH", path: `${loanId}/close` },
    {
      body: { code: "uncollectible", reason: null },
      method: "PATCH",
      path: `${loanId}/write-off`,
    },
    { method: "GET", path: `${loanId}/write-off` },
  ])(
    "scopes $method $path to the URL tenant",
    async ({ body, method, path }) => {
      query.mockResolvedValueOnce({ rows: [] });
      const response = await app.request(
        `/v0/tenant/${otherTenantId}/loan/${path}`,
        body === undefined
          ? { method }
          : {
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
              method,
            },
      );
      expect(response.status).toBe(404);
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('"loans"."tenant_id" =');
      expect(params).toContain(otherTenantId);
      expect(params).toContain(loanId);
    },
  );

  it("creates from a template and returns the embedded loan", async () => {
    query
      .mockResolvedValueOnce({ rows: [[tenantId]] })
      .mockResolvedValueOnce({
        rows: [
          [
            loanTemplateId,
            createdAt,
            null,
            "Template",
            null,
            amount,
            1,
            body.servicingTerms,
            body.duration,
          ],
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const templated = { ...loan, loanTemplateId };
    const response = await app.request(basePath, {
      body: JSON.stringify({
        assignmentId: null,
        installments: body.installments,
        loanTemplateId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const parsed = loanApiSchema.parse(await response.json());
    const createdLoanId = parsed.loanId;
    expect(createdLoanId).toMatch(/^loan_[a-z0-9]{24}$/);
    expect(parsed).toEqual({
      ...templated,
      loanId: createdLoanId,
      installments: [
        {
          ...templated.installments[0],
          installmentId: expect.stringMatching(/^installment_[a-z0-9]{25}$/),
          loanId: createdLoanId,
        },
      ],
    });
    expect(query.mock.calls[2][1]).toEqual([
      expect.stringMatching(/^loan_[a-z0-9]{24}$/),
      tenantId,
      null,
      createdAt,
      null,
      null,
      endsAt,
      loanTemplateId,
      JSON.stringify(amount),
      1,
      JSON.stringify(body.servicingTerms),
      JSON.stringify(loan.servicingState),
      JSON.stringify(body.duration),
    ]);
  });

  it("refuses manual close with a balance and rolls back the transaction", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queueLoan();
    query.mockResolvedValueOnce({ rows: [] });
    const response = await app.request(`${basePath}/${loanId}/close`, {
      method: "PATCH",
    });
    expect(response.status).toBe(409);
    expect(query.mock.calls[0][0]).toContain("for update");
    await expect(transaction.mock.results[0].value).rejects.toThrow(
      "outstanding balance",
    );
    expect(
      query.mock.calls.some(
        ([sql]) =>
          sql.includes('"closed_at" = $1') &&
          !sql.includes('"servicing_state"'),
      ),
    ).toBe(false);
  });

  it("writes off an open loan: stamps, records the event, cancels the schedule", async () => {
    queueLoan();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await app.request(`${basePath}/${loanId}/write-off`, {
      body: JSON.stringify({ code: "uncollectible", reason: "no answer" }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    const parsed = loanApiSchema.parse(await response.json());
    expect(parsed.closedAt).toBe(createdAt);
    expect(parsed.writeOff).toEqual({
      writeOffId: expect.stringMatching(/^write_off_[a-z0-9]{24}$/),
      createdAt,
      code: "uncollectible",
      reason: "no answer",
    });
    expect(parsed.due).toEqual([]);
    expect(parsed.installments[0].canceledAt).toBe(createdAt);
    // Settlement update, schedule cancellation, event insert, loan stamp.
    expect(query.mock.calls[2][0]).toContain('update "loans"');
    expect(query.mock.calls[3][0]).toContain('update "loan_installments"');
    expect(query.mock.calls[4][0]).toContain('insert into "loan_write_offs"');
    expect(query.mock.calls[4][1]).toEqual([
      expect.stringMatching(/^write_off_[a-z0-9]{24}$/),
      loanId,
      createdAt,
      "uncollectible",
      "no answer",
    ]);
    expect(query.mock.calls[5][0]).toContain('update "loans"');
    expect(query.mock.calls[5][1]).toEqual([
      createdAt,
      expect.stringMatching(/^write_off_[a-z0-9]{24}$/),
      loanId,
      tenantId,
    ]);
  });

  it("rejects write-off on a paid-off loan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queueLoan({ result: { ...loan, closedAt: createdAt } });
    const response = await app.request(`${basePath}/${loanId}/write-off`, {
      body: JSON.stringify({ code: "uncollectible", reason: null }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "invalid_state",
      error: "loan is already paid off",
    });
  });

  it("re-write-off is an idempotent no-op keeping the original event", async () => {
    queueLoan({
      result: { ...loan, closedAt: createdAt },
      writeOffId: `write_off_${"a".repeat(24)}`,
    });
    query.mockResolvedValueOnce({
      rows: [
        [`write_off_${"a".repeat(24)}`, loanId, createdAt, "goodwill", null],
      ],
    });
    const response = await app.request(`${basePath}/${loanId}/write-off`, {
      body: JSON.stringify({ code: "uncollectible", reason: "new" }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    const parsed = loanApiSchema.parse(await response.json());
    expect(parsed.writeOff).toEqual({
      writeOffId: `write_off_${"a".repeat(24)}`,
      createdAt,
      code: "goodwill",
      reason: null,
    });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('insert into "loan_write_offs"'),
      ),
    ).toBe(false);
  });

  it("lists write-off history oldest first", async () => {
    query.mockResolvedValueOnce({ rows: [[loanId]] }).mockResolvedValueOnce({
      rows: [
        [
          `write_off_${"a".repeat(24)}`,
          loanId,
          createdAt,
          "goodwill",
          "courtesy",
        ],
        [
          `write_off_${"b".repeat(24)}`,
          loanId,
          createdAt + 1000,
          "uncollectible",
          null,
        ],
      ],
    });
    const response = await app.request(`${basePath}/${loanId}/write-off`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        writeOffId: `write_off_${"a".repeat(24)}`,
        loanId,
        createdAt,
        code: "goodwill",
        reason: "courtesy",
      },
      {
        writeOffId: `write_off_${"b".repeat(24)}`,
        loanId,
        createdAt: createdAt + 1000,
        code: "uncollectible",
        reason: null,
      },
    ]);
  });
});

describe("settlement bridge SQL and transaction ownership", () => {
  it("locks the tenant-scoped loan before allocations and never opens a nested transaction", async () => {
    queueLoan();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await db.transaction((tx) =>
      applyLoanPayment({
        amount: { ...amount, value: 50 },
        at: createdAt,
        loanId,
        tenantId,
        tx,
      }),
    );
    expect(result).toEqual({ principalAmount: 50, interestAmount: 0 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("for update");
    expect(query.mock.calls[0][1]).toEqual([loanId, tenantId]);
    expect(query.mock.calls[2][0]).toContain('update "loan_installments"');
    expect(query.mock.calls[3][0]).toContain('update "loans"');
    expect(query.mock.calls[3][1]).toContainEqual(
      expect.stringContaining('"principalAmount":50'),
    );
  });

  it("rejects overpayment after calculating accrual without writing any state", async () => {
    queueLoan();
    await expect(
      db.transaction((tx) =>
        applyLoanPayment({
          amount: { ...amount, value: 101 },
          at: createdAt + 86_400_000,
          loanId,
          tenantId,
          tx,
        }),
      ),
    ).rejects.toMatchObject({ code: "overpayment" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([sql]) => sql.startsWith("select"))).toBe(
      true,
    );
  });
});
