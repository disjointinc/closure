/** Fixed-principal origination and lifecycle; settlement lives in servicing.ts. */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  assignments,
  loanInstallments,
  loans,
  tenants,
} from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { Loan } from "../../../schemas/loan.ts";
import { loanDefinitionFields } from "../../../schemas/loan.ts";
import { MAX_LOAN_INSTALLMENTS } from "../../../schemas/loan-servicing.ts";
import { getLoanTemplate } from "../../loan-template/service.ts";
import {
  calculateLoan,
  calendarDeadline,
  type LoanDue,
} from "./calculation.ts";
import { LoanServicingError, serviceLoan } from "./servicing.ts";
import type { LoanCreateBody } from "./routes.ts";

export async function listLoans({
  tenantId,
}: {
  tenantId: string;
}): Promise<Loan[]> {
  const rows = await db
    .select({ loanId: loans.loanId })
    .from(loans)
    .where(eq(loans.tenantId, tenantId))
    .orderBy(desc(loans.createdAt));
  const found = await Promise.all(
    rows.map((row) => getLoan({ loanId: row.loanId, tenantId })),
  );
  return found.filter((loan) => loan !== null);
}

export async function getLoan({
  loanId,
  tenantId,
}: {
  loanId: string;
  tenantId: string;
}): Promise<Loan | null> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select()
        .from(loans)
        .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)));
      if (!row) {
        return null;
      }
      const installmentRows = await tx
        .select()
        .from(loanInstallments)
        .where(
          and(
            eq(loanInstallments.loanId, loanId),
            isNull(loanInstallments.canceledAt),
          ),
        )
        .orderBy(loanInstallments.dueAt, loanInstallments.createdAt);
      /* Balances and obligations are projected to now without persisting;
       * the stored checkpoint only advances on settlement interactions. */
      const projected = projectLoan({
        installments: installmentRows,
        loan: row,
      });
      return {
        ...projected.loan,
        due: projected.due,
        installments: installmentRows,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/* Read-time projection: accrue to now in memory. Legacy (unserviced) loans
 * have no checkpoint to project from, so they return empty obligations. */
function projectLoan({
  installments,
  loan,
}: {
  installments: (typeof loanInstallments.$inferSelect)[];
  loan: typeof loans.$inferSelect;
}): { due: LoanDue[]; loan: typeof loans.$inferSelect } {
  if (loan.servicingTerms === null || loan.servicingState === null) {
    return { due: [], loan };
  }
  /* A read never moves backward: project from at least the checkpoint so
   * same-millisecond origination reads cannot trip the backdate guard. */
  const at = Math.max(Date.now(), loan.servicingState.checkpointAt);
  const result = calculateLoan({
    action: { type: "service" },
    at,
    installments,
    loan,
  });
  return { due: result.due, loan: result.loan };
}

export async function createLoan({
  loan,
  tenantId,
}: {
  loan: LoanCreateBody;
  tenantId: string;
}): Promise<Loan | null | { error: string }> {
  const [tenant] = await db
    .select({ tenantId: tenants.tenantId })
    .from(tenants)
    .where(eq(tenants.tenantId, tenantId));
  if (!tenant) {
    return null;
  }
  if (loan.assignmentId !== null) {
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.assignmentId, loan.assignmentId),
          eq(assignments.tenantId, tenantId),
        ),
      );
    if (!assignment) {
      return null;
    }
  }
  const loanId = generateId({ prefix: "loan" });
  const createdAt = Date.now();
  let definition: Pick<
    Loan,
    | "duration"
    | "annualInterestPercentage"
    | "loanTemplateId"
    | "principal"
    | "servicingTerms"
  >;
  if (loan.loanTemplateId !== null) {
    const template = await getLoanTemplate({
      loanTemplateId: loan.loanTemplateId,
    });
    if (!template) {
      return null;
    }
    if (template.deprecatedAt !== null || template.servicingTerms === null) {
      return {
        error:
          "deprecated or legacy templates cannot originate loans; create a new template with servicing terms",
      };
    }
    definition = {
      duration: template.duration,
      annualInterestPercentage: template.annualInterestPercentage,
      loanTemplateId: template.loanTemplateId,
      principal: template.principal,
      servicingTerms: template.servicingTerms,
    };
  } else {
    definition = {
      duration: loan.duration,
      annualInterestPercentage: loan.annualInterestPercentage,
      loanTemplateId: null,
      principal: loan.principal,
      servicingTerms: loan.servicingTerms,
    };
  }
  const terms = loanDefinitionFields.servicingTerms.safeParse(
    definition.servicingTerms,
  );
  if (
    !terms.success ||
    !loanDefinitionFields.principal.safeParse(definition.principal).success ||
    !loanDefinitionFields.annualInterestPercentage.safeParse(
      definition.annualInterestPercentage,
    ).success ||
    !loanDefinitionFields.duration.safeParse(definition.duration).success
  ) {
    return { error: "invalid loan definition" };
  }
  const endsAt = calendarDeadline({
    anchorAt: createdAt,
    duration: definition.duration,
  });
  const repayment = terms.data.repayment;
  if (
    loan.installments.length > MAX_LOAN_INSTALLMENTS ||
    (repayment.type === "fixed_schedule"
      ? loan.installments.length === 0
      : loan.installments.length !== 0)
  ) {
    return {
      error:
        "only fixed_schedule accepts installments, and it requires a nonempty schedule",
    };
  }
  let previousDueAt = createdAt;
  let scheduledAmount = 0n;
  for (const installment of loan.installments) {
    if (
      !loanDefinitionFields.principal.safeParse(installment.amount).success ||
      installment.amount.currency !== definition.principal.currency ||
      installment.amount.unit !== definition.principal.unit ||
      !Number.isSafeInteger(installment.dueAt) ||
      installment.dueAt <= previousDueAt ||
      installment.dueAt > endsAt
    ) {
      return {
        error:
          "installments require matching currency/unit and strictly increasing deadlines after origination through maturity",
      };
    }
    previousDueAt = installment.dueAt;
    scheduledAmount += BigInt(installment.amount.value);
  }
  if (scheduledAmount > BigInt(definition.principal.value)) {
    return {
      error:
        "fixed schedule total cannot exceed original principal; remaining principal and interest become due at maturity",
    };
  }
  if (repayment.type === "periodic_minimum") {
    const amount =
      repayment.minimum.type === "fixed"
        ? repayment.minimum.amount
        : repayment.minimum.floor;
    if (
      amount.currency !== definition.principal.currency ||
      amount.unit !== definition.principal.unit
    ) {
      return {
        error: "minimum amount/floor must use the loan currency and unit",
      };
    }
  }
  await db.transaction(async (tx) => {
    await tx.insert(loans).values({
      assignmentId: loan.assignmentId,
      closedAt: null,
      createdAt,
      deletedAt: null,
      endsAt,
      loanId,
      tenantId,
      ...definition,
      servicingState: {
        checkpointAt: createdAt,
        interestAmount: 0,
        interestCarry: "0",
        principalAmount: definition.principal.value,
      },
    });
    if (loan.installments.length === 0) {
      return;
    }
    await tx.insert(loanInstallments).values(
      loan.installments.map((installment) => ({
        allocatedAmount: 0,
        amount: installment.amount,
        createdAt,
        canceledAt: null,
        dueAt: installment.dueAt,
        installmentId: generateId({ prefix: "installment" }),
        loanId,
        paidAt: null,
      })),
    );
  });
  return getLoan({ loanId, tenantId });
}

/** Closing never forgives debt; legacy balances cannot establish payoff. */
export async function closeLoan({
  loanId,
  tenantId,
}: {
  loanId: string;
  tenantId: string;
}): Promise<Loan | null> {
  const found = await db.transaction(async (tx) => {
    const at = Date.now();
    const row = await serviceLoan({ at, loanId, tenantId, tx });
    if (!row) {
      return false;
    }
    if (
      !row.servicingState ||
      row.servicingState.principalAmount !== 0 ||
      row.servicingState.interestAmount !== 0 ||
      row.servicingState.interestCarry !== "0"
    ) {
      throw new LoanServicingError({
        code: "invalid_state",
        message: "cannot close a loan with an outstanding balance",
      });
    }
    await tx
      .update(loans)
      .set({ closedAt: row.closedAt ?? at })
      .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)));
    return true;
  });
  if (!found) {
    return null;
  }
  return getLoan({ loanId, tenantId });
}

/** Archive only paid-off serviced loans; legacy rows may still be archived. */
export async function deleteLoan({
  loanId,
  tenantId,
}: {
  loanId: string;
  tenantId: string;
}): Promise<Loan | null> {
  const found = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)))
      .for("update");
    if (!row || row.deletedAt !== null) {
      return false;
    }
    if (
      row.servicingState &&
      (row.closedAt === null ||
        row.servicingState.principalAmount !== 0 ||
        row.servicingState.interestAmount !== 0)
    ) {
      throw new LoanServicingError({
        code: "invalid_state",
        message: "only paid-off loans can be deleted",
      });
    }
    await tx
      .update(loans)
      .set({ deletedAt: Date.now() })
      .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)));
    return true;
  });
  if (!found) {
    return null;
  }
  return getLoan({ loanId, tenantId });
}
