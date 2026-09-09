/**
 * v0/tenant/payment/service.ts -- payment business logic. The server mints
 * the payment id and stamps createdAt; lifecycle timestamps are stamped by
 * PATCH transitions as the 3P provider reports them. Loan repayment linkage
 * lives in payment_loans, mirroring payment_invoices for invoice targets.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  invoices,
  loans,
  paymentInvoices,
  paymentLoans,
  payments,
} from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { Payment } from "../../../schemas/payment.ts";
import type { PaymentCreateBody, PaymentPatchBody } from "./routes.ts";
import { applyLoanPayment, LoanServicingError } from "../loan/servicing.ts";

export async function getPayment({
  paymentId,
  tenantId,
}: {
  paymentId: string;
  tenantId: string;
}): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(
      and(eq(payments.paymentId, paymentId), eq(payments.tenantId, tenantId)),
    );
  if (!row) {
    return null;
  }
  const invoiceRows = await db
    .select()
    .from(paymentInvoices)
    .where(eq(paymentInvoices.paymentId, paymentId));
  const [loanRow] = await db
    .select()
    .from(paymentLoans)
    .where(eq(paymentLoans.paymentId, paymentId));
  return {
    paymentId: row.paymentId,
    loan: loanRow
      ? {
          loanId: loanRow.loanId,
          amount: loanRow.amount,
          principalAmount: loanRow.principalAmount,
          interestAmount: loanRow.interestAmount,
        }
      : null,
    createdAt: row.createdAt,
    startedProcessingAt: row.startedProcessingAt,
    succeededAt: row.succeededAt,
    failedAt: row.failedAt,
    providerInternals: row.providerInternals,
    invoiceIds: invoiceRows.map((invoice) => invoice.invoiceId),
  };
}

export async function listPayments({
  tenantId,
}: {
  tenantId: string;
}): Promise<Payment[]> {
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.tenantId, tenantId))
    .orderBy(desc(payments.createdAt));
  const found = await Promise.all(
    rows.map((row) => getPayment({ paymentId: row.paymentId, tenantId })),
  );
  return found.filter((payment) => payment !== null);
}

export async function createPayment({
  payment,
  tenantId,
}: {
  payment: PaymentCreateBody;
  tenantId: string;
}): Promise<Payment | null> {
  if (
    payment.loan !== null &&
    (payment.invoiceIds.length > 0 ||
      !Number.isSafeInteger(payment.loan.amount.value) ||
      payment.loan.amount.value <= 0)
  ) {
    throw new LoanServicingError({
      code: "invalid_input",
      message: "loan payments require a positive amount and no invoices",
    });
  }
  const paymentId = generateId({ prefix: "payment" });
  const createdAt = Date.now();
  return db.transaction(async (tx) => {
    const providerMatch = and(
      eq(payments.tenantId, tenantId),
      sql`${payments.providerInternals}->>'provider' = ${payment.providerInternals.provider}`,
      sql`${payments.providerInternals}->>'paymentId' = ${payment.providerInternals.paymentId}`,
    );
    if (payment.loan !== null) {
      const [loan] = await tx
        .select({ principal: loans.principal })
        .from(loans)
        .where(
          and(
            eq(loans.loanId, payment.loan.loanId),
            eq(loans.tenantId, tenantId),
          ),
        )
        .for("update");
      if (!loan) {
        return null;
      }
      if (
        payment.loan.amount.currency !== loan.principal.currency ||
        payment.loan.amount.unit !== loan.principal.unit
      ) {
        throw new LoanServicingError({
          code: "invalid_input",
          message: "payment currency/unit must match the loan",
        });
      }
    }
    const [existing] = await tx.select().from(payments).where(providerMatch);
    if (existing) {
      const invoiceRows = await tx
        .select({ invoiceId: paymentInvoices.invoiceId })
        .from(paymentInvoices)
        .where(eq(paymentInvoices.paymentId, existing.paymentId));
      const [existingLoan] = await tx
        .select()
        .from(paymentLoans)
        .where(eq(paymentLoans.paymentId, existing.paymentId));
      const invoiceIds = new Set(payment.invoiceIds);
      if (
        (existingLoan?.loanId ?? null) !== (payment.loan?.loanId ?? null) ||
        existingLoan?.amount.value !== payment.loan?.amount.value ||
        existingLoan?.amount.currency !== payment.loan?.amount.currency ||
        existingLoan?.amount.unit !== payment.loan?.amount.unit ||
        existing.providerInternals.customerId !==
          payment.providerInternals.customerId ||
        invoiceRows.length !== invoiceIds.size ||
        invoiceRows.some((invoice) => !invoiceIds.has(invoice.invoiceId))
      ) {
        throw new LoanServicingError({
          code: "invalid_state",
          message: "provider payment already exists with a different payload",
        });
      }
      return {
        ...existing,
        loan: existingLoan
          ? {
              loanId: existingLoan.loanId,
              amount: existingLoan.amount,
              principalAmount: existingLoan.principalAmount,
              interestAmount: existingLoan.interestAmount,
            }
          : null,
        invoiceIds: invoiceRows.map((invoice) => invoice.invoiceId),
      };
    }
    if (payment.invoiceIds.length > 0) {
      const linked = await tx
        .select({ invoiceId: invoices.invoiceId })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            inArray(invoices.invoiceId, payment.invoiceIds),
          ),
        );
      if (linked.length !== new Set(payment.invoiceIds).size) {
        return null;
      }
    }
    const row = {
      paymentId,
      tenantId,
      createdAt,
      startedProcessingAt: null,
      succeededAt: null,
      failedAt: null,
      providerInternals: payment.providerInternals,
    };
    const inserted = await tx
      .insert(payments)
      .values(row)
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      // The provider index arbitrates concurrent creates across all targets.
      throw new LoanServicingError({
        code: "invalid_state",
        message: "provider payment already exists",
      });
    }
    if (payment.invoiceIds.length > 0) {
      await tx
        .insert(paymentInvoices)
        .values(
          payment.invoiceIds.map((invoiceId) => ({
            paymentId,
            invoiceId,
          })),
        )
        .onConflictDoNothing();
    }
    if (payment.loan !== null) {
      await tx.insert(paymentLoans).values({
        paymentId,
        loanId: payment.loan.loanId,
        amount: payment.loan.amount,
        principalAmount: null,
        interestAmount: null,
      });
    }
    const loan = payment.loan
      ? { ...payment.loan, principalAmount: null, interestAmount: null }
      : null;
    return { ...row, loan, invoiceIds: payment.invoiceIds };
  });
}

/** The lifecycle column each PATCH event stamps. */
const eventToColumn: Record<
  PaymentPatchBody["event"],
  "startedProcessingAt" | "succeededAt" | "failedAt"
> = {
  started_processing: "startedProcessingAt",
  succeeded: "succeededAt",
  failed: "failedAt",
};

/** Stamp the patched lifecycle transition, or null if no such payment. */
export async function patchPayment({
  patch,
  paymentId,
  tenantId,
}: {
  patch: PaymentPatchBody;
  paymentId: string;
  tenantId: string;
}): Promise<Payment | null> {
  const found = await db.transaction(async (tx) => {
    const scope = and(
      eq(payments.paymentId, paymentId),
      eq(payments.tenantId, tenantId),
    );
    const [row] = await tx.select().from(payments).where(scope).for("update");
    if (!row) {
      return null;
    }
    if (
      (row.succeededAt !== null && patch.event !== "succeeded") ||
      (row.failedAt !== null && patch.event !== "failed")
    ) {
      throw new LoanServicingError({
        code: "invalid_state",
        message: "payment is already terminal",
      });
    }
    if (row[eventToColumn[patch.event]] !== null) {
      return true;
    }
    const [loanRow] = await tx
      .select()
      .from(paymentLoans)
      .where(eq(paymentLoans.paymentId, paymentId));
    if (patch.event === "succeeded" && loanRow) {
      const [loan] = await tx
        .select({ loanId: loans.loanId })
        .from(loans)
        .where(
          and(eq(loans.loanId, loanRow.loanId), eq(loans.tenantId, tenantId)),
        )
        .for("update");
      if (!loan) {
        return null;
      }
      // The settlement timestamp is taken under the loan lock it serializes on.
      const at = Date.now();
      const allocation = await applyLoanPayment({
        amount: loanRow.amount,
        at,
        loanId: loanRow.loanId,
        tenantId,
        tx,
      });
      if (!allocation) {
        throw new LoanServicingError({
          code: "invalid_state",
          message: "locked loan disappeared",
        });
      }
      await tx
        .update(paymentLoans)
        .set({
          principalAmount: allocation.principalAmount,
          interestAmount: allocation.interestAmount,
        })
        .where(eq(paymentLoans.paymentId, paymentId));
      await tx
        .update(payments)
        .set({ [eventToColumn[patch.event]]: at })
        .where(scope);
      return true;
    }
    await tx
      .update(payments)
      .set({ [eventToColumn[patch.event]]: Date.now() })
      .where(scope);
    return true;
  });
  return found ? getPayment({ paymentId, tenantId }) : null;
}
