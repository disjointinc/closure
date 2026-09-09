/**
 * v0/tenant/refund/service.ts -- refund business logic. The refunded amount
 * is an owned value: the call surface passes it inline and reads it back as a
 * full object, while the db stores only the value id. The server mints the
 * refund and value ids and stamps createdAt; lifecycle timestamps are
 * stamped by PATCH transitions as the 3P provider reports them.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  loans,
  paymentLoans,
  payments,
  refunds,
  values,
} from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import { type Refund } from "../../../schemas/refund.ts";
import { type Value } from "../../../schemas/value.ts";
import type { RefundApi, RefundCreateBody, RefundPatchBody } from "./routes.ts";
import {
  LoanServicingError,
  reverseLoanPayment,
  type LoanTransaction,
} from "../loan/servicing.ts";

async function expandRefund(row: Refund): Promise<RefundApi> {
  const [value] = await db
    .select()
    .from(values)
    .where(eq(values.valueId, row.valueId));
  // refunds.value_id FKs values, so the row always exists.
  return { ...row, value: value as Value };
}

export async function getRefund({
  refundId,
  tenantId,
}: {
  refundId: string;
  tenantId: string;
}): Promise<RefundApi | null> {
  const [row] = await db
    .select()
    .from(refunds)
    .where(and(eq(refunds.refundId, refundId), eq(refunds.tenantId, tenantId)));
  return row ? await expandRefund(row) : null;
}

export async function listRefunds({
  tenantId,
}: {
  tenantId: string;
}): Promise<RefundApi[]> {
  const rows = await db
    .select()
    .from(refunds)
    .where(eq(refunds.tenantId, tenantId))
    .orderBy(desc(refunds.createdAt));
  return Promise.all(rows.map(expandRefund));
}

export async function createRefund({
  refund,
  tenantId,
}: {
  refund: RefundCreateBody;
  tenantId: string;
}): Promise<RefundApi | null> {
  const refundId = generateId({ prefix: "refund" });
  const { value, ...rest } = refund;
  const fullValue: Value = {
    ...value,
    valueId: generateId({ prefix: "value" }),
    createdAt: Date.now(),
    deprecatedAt: null,
  };
  const createdAt = Date.now();
  return db.transaction(async (tx) => {
    if (refund.paymentId !== null) {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.paymentId, refund.paymentId),
            eq(payments.tenantId, tenantId),
          ),
        )
        .for("update");
      if (!payment) {
        return null;
      }
      await refundAllocation({ payment, tenantId, tx, value });
    }
    await tx.insert(values).values(fullValue);
    await tx.insert(refunds).values({
      ...rest,
      refundId,
      tenantId,
      createdAt,
      startedProcessingAt: null,
      succeededAt: null,
      failedAt: null,
      loanPrincipalAmount: null,
      loanInterestAmount: null,
      valueId: fullValue.valueId,
    });
    return {
      ...rest,
      refundId,
      tenantId,
      createdAt,
      startedProcessingAt: null,
      succeededAt: null,
      failedAt: null,
      loanPrincipalAmount: null,
      loanInterestAmount: null,
      value: fullValue,
    };
  });
}

/* The original payment lock serializes all linked refund creation/settlement.
 * Reverse principal first, then interest, using only successful prior refunds;
 * pending requests do not reserve any part of the original allocation. */
async function refundAllocation({
  payment,
  tenantId,
  tx,
  value,
}: {
  payment: typeof payments.$inferSelect;
  tenantId: string;
  tx: LoanTransaction;
  value: RefundCreateBody["value"];
}) {
  const [link] = await tx
    .select()
    .from(paymentLoans)
    .where(eq(paymentLoans.paymentId, payment.paymentId));
  if (
    !link ||
    payment.succeededAt === null ||
    payment.failedAt !== null ||
    link.principalAmount === null ||
    link.interestAmount === null
  ) {
    throw new LoanServicingError({
      code: "invalid_input",
      message: "refund requires a successful loan payment",
    });
  }
  const amount = value.amounts[0];
  if (
    value.amounts.length !== 1 ||
    !amount ||
    amount.currency !== link.amount.currency ||
    amount.unit !== link.amount.unit ||
    !Number.isSafeInteger(amount.value) ||
    amount.value <= 0
  ) {
    throw new LoanServicingError({
      code: "invalid_input",
      message:
        "refund requires one positive amount in the payment currency/unit",
    });
  }
  let principalAmount = link.principalAmount;
  let interestAmount = link.interestAmount;
  if (
    !Number.isSafeInteger(principalAmount) ||
    principalAmount < 0 ||
    !Number.isSafeInteger(interestAmount) ||
    interestAmount < 0 ||
    principalAmount + interestAmount !== link.amount.value
  ) {
    throw new LoanServicingError({
      code: "invalid_state",
      message: "invalid original payment allocation",
    });
  }
  const prior = await tx
    .select({ refund: refunds, value: values })
    .from(refunds)
    .innerJoin(values, eq(refunds.valueId, values.valueId))
    .where(
      and(
        eq(refunds.paymentId, payment.paymentId),
        eq(refunds.tenantId, tenantId),
        isNotNull(refunds.succeededAt),
      ),
    );
  for (const item of prior) {
    const principal = item.refund.loanPrincipalAmount;
    const interest = item.refund.loanInterestAmount;
    const refunded = item.value.amounts[0];
    if (
      principal === null ||
      interest === null ||
      !Number.isSafeInteger(principal) ||
      !Number.isSafeInteger(interest) ||
      principal < 0 ||
      interest < 0 ||
      principal > principalAmount ||
      interest > interestAmount ||
      item.refund.failedAt !== null ||
      item.value.amounts.length !== 1 ||
      !refunded ||
      refunded.currency !== amount.currency ||
      refunded.unit !== amount.unit ||
      principal + interest !== refunded.value
    ) {
      throw new LoanServicingError({
        code: "invalid_state",
        message: "invalid successful refund allocation",
      });
    }
    principalAmount -= principal;
    interestAmount -= interest;
  }
  if (amount.value > principalAmount + interestAmount) {
    throw new LoanServicingError({
      code: "overpayment",
      message: "refund exceeds the remaining payment allocation",
    });
  }
  principalAmount = Math.min(amount.value, principalAmount);
  return { interestAmount: amount.value - principalAmount, principalAmount };
}

/** The lifecycle column each PATCH event stamps. */
const eventToColumn: Record<
  RefundPatchBody["event"],
  "startedProcessingAt" | "succeededAt" | "failedAt"
> = {
  started_processing: "startedProcessingAt",
  succeeded: "succeededAt",
  failed: "failedAt",
};

/** Stamp the patched lifecycle transition, or null if no such refund. */
export async function patchRefund({
  patch,
  refundId,
  tenantId,
}: {
  patch: RefundPatchBody;
  refundId: string;
  tenantId: string;
}): Promise<RefundApi | null> {
  const found = await db.transaction(async (tx) => {
    const scope = and(
      eq(refunds.refundId, refundId),
      eq(refunds.tenantId, tenantId),
    );
    const [original] = await tx.select().from(refunds).where(scope);
    if (!original) {
      return null;
    }
    // Read the immutable parent link, then always lock parent before child.
    const [payment] =
      original.paymentId === null
        ? []
        : await tx
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.paymentId, original.paymentId),
                eq(payments.tenantId, tenantId),
              ),
            )
            .for("update");
    if (original.paymentId !== null && !payment) {
      return null;
    }
    const [row] = await tx.select().from(refunds).where(scope).for("update");
    if (!row) {
      return null;
    }
    if (
      (row.succeededAt !== null && patch.event !== "succeeded") ||
      (row.failedAt !== null && patch.event !== "failed")
    ) {
      throw new LoanServicingError({
        code: "invalid_state",
        message: "refund is already terminal",
      });
    }
    if (row[eventToColumn[patch.event]] !== null) {
      return true;
    }
    const at = Date.now();
    let allocation = null;
    if (patch.event === "succeeded" && payment) {
      const [value] = await tx
        .select()
        .from(values)
        .where(eq(values.valueId, row.valueId));
      if (!value) {
        throw new LoanServicingError({
          code: "invalid_state",
          message: "refund value is missing",
        });
      }
      allocation = await refundAllocation({ payment, tenantId, tx, value });
      const [link] = await tx
        .select()
        .from(paymentLoans)
        .where(eq(paymentLoans.paymentId, payment.paymentId));
      if (!link) {
        throw new LoanServicingError({
          code: "invalid_state",
          message: "payment loan is missing",
        });
      }
      const [loan] = await tx
        .select({ loanId: loans.loanId })
        .from(loans)
        .where(and(eq(loans.loanId, link.loanId), eq(loans.tenantId, tenantId)))
        .for("update");
      if (!loan) {
        return null;
      }
      allocation = await reverseLoanPayment({
        ...allocation,
        at,
        loanId: link.loanId,
        tenantId,
        tx,
      });
      if (!allocation) {
        throw new LoanServicingError({
          code: "invalid_state",
          message: "locked loan disappeared",
        });
      }
    }
    await tx
      .update(refunds)
      .set({
        [eventToColumn[patch.event]]: at,
        ...(allocation === null
          ? {}
          : {
              loanPrincipalAmount: allocation.principalAmount,
              loanInterestAmount: allocation.interestAmount,
            }),
      })
      .where(scope);
    return true;
  });
  return found ? getRefund({ refundId, tenantId }) : null;
}
