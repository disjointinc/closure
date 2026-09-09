import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { loanInstallments, loans } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { CurrencyAmount } from "../../../schemas/common.ts";
import { calculateLoan, type LoanAction } from "./calculation.ts";

export { LoanServicingError, type LoanRow } from "./calculation.ts";
export type LoanTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
type ServicingInput = {
  at: number;
  loanId: string;
  tenantId: string;
  tx: LoanTransaction;
};

/* The caller owns the transaction and must let exceptions roll it back. Payment
 * and refund idempotency/history belong to their settlement rows, not this bridge. */
async function transitionLoan({
  action,
  at,
  loanId,
  tenantId,
  tx,
}: ServicingInput & { action: LoanAction }) {
  const [row] = await tx
    .select()
    .from(loans)
    .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)))
    .for("update");
  if (!row) {
    return null;
  }
  const installments = await tx
    .select()
    .from(loanInstallments)
    .where(
      and(
        eq(loanInstallments.loanId, loanId),
        isNull(loanInstallments.canceledAt),
      ),
    )
    .orderBy(loanInstallments.dueAt, loanInstallments.createdAt);
  const result = calculateLoan({ action, at, installments, loan: row });
  if (action.type === "service" && row.closedAt !== null) {
    return result;
  }
  const originals = new Map(
    installments.map((item) => [item.installmentId, item]),
  );
  for (const installment of result.installments) {
    const original = originals.get(installment.installmentId);
    if (
      original &&
      original.allocatedAmount === installment.allocatedAmount &&
      original.canceledAt === installment.canceledAt &&
      original.paidAt === installment.paidAt
    ) {
      continue;
    }
    await tx
      .update(loanInstallments)
      .set({
        allocatedAmount: installment.allocatedAmount,
        canceledAt: installment.canceledAt,
        paidAt: installment.paidAt,
      })
      .where(
        and(
          eq(loanInstallments.installmentId, installment.installmentId),
          eq(loanInstallments.loanId, loanId),
        ),
      );
  }
  if (result.generated.length > 0) {
    await tx.insert(loanInstallments).values(
      result.generated.map((installment) => ({
        ...installment,
        installmentId: generateId({ prefix: "installment" }),
      })),
    );
  }
  await tx
    .update(loans)
    .set({
      closedAt: result.loan.closedAt,
      servicingState: result.loan.servicingState,
    })
    .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)));
  return result;
}

/** The full settlement: post-transition loan, obligations, and live installments. */
export async function serviceLoanDetail(input: ServicingInput) {
  const result = await transitionLoan({
    ...input,
    action: { type: "service" },
  });
  if (!result) {
    return null;
  }
  return {
    due: result.due,
    installments: result.installments,
    loan: result.loan,
  };
}

export async function applyLoanPayment({
  amount,
  ...input
}: ServicingInput & { amount: CurrencyAmount }) {
  const result = await transitionLoan({
    ...input,
    action: { amount, type: "payment" },
  });
  return result?.allocation ?? null;
}

export async function reverseLoanPayment({
  interestAmount,
  principalAmount,
  ...input
}: ServicingInput & { interestAmount: number; principalAmount: number }) {
  const result = await transitionLoan({
    ...input,
    action: { interestAmount, principalAmount, type: "reversal" },
  });
  return result?.allocation ?? null;
}
