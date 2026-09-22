/** Fixed-principal origination and lifecycle; settlement lives in servicing.ts. */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  assignments,
  loanInstallments,
  loans,
  loanWriteOffs,
  tenants,
} from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { Loan } from "../../../schemas/loan.ts";
import { loanDefinitionFields } from "../../../schemas/loan.ts";
import { MAX_LOAN_INSTALLMENTS } from "../../../schemas/loan-servicing.ts";
import type { WriteOff, WriteOffCode } from "../../../schemas/write-off.ts";
import { getLoanTemplate } from "../../loan-template/service.ts";
import {
  calculateLoan,
  calendarDeadline,
  type LoanDue,
} from "./calculation.ts";
import { LoanServicingError, serviceLoanDetail } from "./servicing.ts";
import type { LoanApi, LoanCreateBody } from "./routes.ts";

/** The API write-off: the event row minus the redundant parent FK. */
type WriteOffEvent = {
  writeOffId: string;
  createdAt: number;
  code: WriteOffCode;
  reason: string | null;
};

/** Fetch write-off events by id (the loans' current-state pointer targets). */
async function writeOffsById({
  writeOffIds,
}: {
  writeOffIds: string[];
}): Promise<Map<string, WriteOffEvent>> {
  const events = new Map<string, WriteOffEvent>();
  if (writeOffIds.length === 0) {
    return events;
  }
  const rows = await db
    .select()
    .from(loanWriteOffs)
    .where(inArray(loanWriteOffs.writeOffId, writeOffIds));
  for (const row of rows) {
    events.set(row.writeOffId, {
      writeOffId: row.writeOffId,
      createdAt: row.createdAt,
      // Codes were zod-validated at the write boundary, so they always parse.
      code: row.code as WriteOffCode,
      reason: row.reason,
    });
  }
  return events;
}

/** Shape a loan row (+ its current write-off event) into the API loan. */
function toApiLoan({
  due,
  installments,
  row,
  writeOff,
}: {
  due: LoanDue[];
  installments: (typeof loanInstallments.$inferSelect)[];
  row: typeof loans.$inferSelect;
  writeOff: WriteOffEvent | null;
}): LoanApi {
  /* writeOffId stays internal: the API loan embeds the event itself. */
  const { writeOffId, ...fields } = row;
  return { ...fields, writeOff, due, installments };
}

export async function listLoans({
  tenantId,
}: {
  tenantId: string;
}): Promise<LoanApi[]> {
  const rows = await db
    .select()
    .from(loans)
    .where(eq(loans.tenantId, tenantId))
    .orderBy(desc(loans.createdAt));
  if (rows.length === 0) {
    return [];
  }
  const installmentRows = await db
    .select()
    .from(loanInstallments)
    .where(
      and(
        inArray(
          loanInstallments.loanId,
          rows.map((row) => row.loanId),
        ),
        isNull(loanInstallments.canceledAt),
      ),
    )
    .orderBy(loanInstallments.dueAt, loanInstallments.createdAt);
  const installmentsByLoan = new Map<string, typeof installmentRows>();
  for (const installment of installmentRows) {
    installmentsByLoan.set(installment.loanId, [
      ...(installmentsByLoan.get(installment.loanId) ?? []),
      installment,
    ]);
  }
  const writeOffs = await writeOffsById({
    writeOffIds: rows.flatMap((row) =>
      row.writeOffId === null ? [] : [row.writeOffId],
    ),
  });
  return rows.map((row) => {
    const installments = installmentsByLoan.get(row.loanId) ?? [];
    const projected = projectLoan({ installments, loan: row });
    const writeOff =
      row.writeOffId === null ? null : (writeOffs.get(row.writeOffId) ?? null);
    return toApiLoan({
      due: projected.due,
      installments,
      row: projected.loan,
      writeOff,
    });
  });
}

export async function getLoan({
  loanId,
  tenantId,
}: {
  loanId: string;
  tenantId: string;
}): Promise<LoanApi | null> {
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
      const writeOff =
        row.writeOffId === null
          ? null
          : ((await writeOffsById({ writeOffIds: [row.writeOffId] })).get(
              row.writeOffId,
            ) ?? null);
      return toApiLoan({
        due: projected.due,
        installments: installmentRows,
        row: projected.loan,
        writeOff,
      });
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
}): Promise<LoanApi | null | { error: string }> {
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
  const servicingState = {
    checkpointAt: createdAt,
    interestAmount: 0,
    interestCarry: "0",
    principalAmount: definition.principal.value,
  };
  const installmentRows = loan.installments.map((installment) => ({
    allocatedAmount: 0,
    amount: installment.amount,
    createdAt,
    canceledAt: null,
    dueAt: installment.dueAt,
    installmentId: generateId({ prefix: "installment" }),
    loanId,
    paidAt: null,
  }));
  const inserted = {
    assignmentId: loan.assignmentId,
    closedAt: null,
    createdAt,
    endsAt,
    loanId,
    tenantId,
    writeOffId: null,
    ...definition,
    servicingState,
  };
  await db.transaction(async (tx) => {
    await tx.insert(loans).values(inserted);
    if (installmentRows.length > 0) {
      await tx.insert(loanInstallments).values(installmentRows);
    }
  });
  /* The write is deterministic: every column and id was minted above, and
   * projectLoan derives the same obligations getLoan would re-read. */
  const projected = projectLoan({
    installments: installmentRows,
    loan: inserted,
  });
  return toApiLoan({
    due: projected.due,
    installments: installmentRows,
    row: projected.loan,
    writeOff: null,
  });
}

/** Closing never forgives debt; legacy balances cannot establish payoff. */
export async function closeLoan({
  loanId,
  tenantId,
}: {
  loanId: string;
  tenantId: string;
}): Promise<LoanApi | null> {
  return db.transaction(async (tx) => {
    const at = Date.now();
    const settled = await serviceLoanDetail({ at, loanId, tenantId, tx });
    if (!settled) {
      return null;
    }
    const row = settled.loan;
    if (row.closedAt !== null) {
      /* Already closed (paid off or written off): closing is a no-op that
       * keeps the original stamp and cause. */
      const writeOff =
        row.writeOffId === null
          ? null
          : ((await writeOffsById({ writeOffIds: [row.writeOffId] })).get(
              row.writeOffId,
            ) ?? null);
      return toApiLoan({
        due: settled.due,
        installments: settled.installments,
        row,
        writeOff,
      });
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
      .set({ closedAt: at })
      .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)));
    /* The settlement result already holds the post-settlement row and live
     * installments; only closedAt needed a stamp. */
    return toApiLoan({
      due: settled.due,
      installments: settled.installments,
      row: { ...row, closedAt: at },
      writeOff: null,
    });
  });
}

/**
 * Write off an open loan: stop collection (closedAt stamped, live
 * installments canceled, no further accrual) while the debt stays on
 * record. One append-only loan_write_offs row carries the code/reason.
 */
export async function writeOffLoan({
  code,
  loanId,
  reason,
  tenantId,
}: {
  code: WriteOffCode;
  loanId: string;
  reason: string | null;
  tenantId: string;
}): Promise<LoanApi | null> {
  return db.transaction(async (tx) => {
    const at = Date.now();
    const settled = await serviceLoanDetail({ at, loanId, tenantId, tx });
    if (!settled) {
      return null;
    }
    const row = settled.loan;
    if (row.writeOffId !== null) {
      // Idempotent: keep the original stamp and event.
      const writeOff =
        (await writeOffsById({ writeOffIds: [row.writeOffId] })).get(
          row.writeOffId,
        ) ?? null;
      return toApiLoan({
        due: settled.due,
        installments: settled.installments,
        row,
        writeOff,
      });
    }
    if (row.closedAt !== null) {
      throw new LoanServicingError({
        code: "invalid_state",
        message: "loan is already paid off",
      });
    }
    /* Cancel live, under-allocated installments (mirroring payoff
     * cancellation): a written-off loan shows no open schedule. */
    const installments = [];
    for (const installment of settled.installments) {
      const open =
        (installment.allocatedAmount ?? 0) < installment.amount.value;
      if (open) {
        await tx
          .update(loanInstallments)
          .set({ canceledAt: at })
          .where(eq(loanInstallments.installmentId, installment.installmentId));
      }
      installments.push(
        open ? { ...installment, canceledAt: at } : installment,
      );
    }
    const writeOffId = generateId({ prefix: "write_off" });
    await tx.insert(loanWriteOffs).values({
      writeOffId,
      loanId,
      createdAt: at,
      code,
      reason,
    });
    await tx
      .update(loans)
      .set({ closedAt: at, writeOffId })
      .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)));
    return toApiLoan({
      due: [],
      installments,
      row: { ...row, closedAt: at, writeOffId },
      writeOff: { writeOffId, createdAt: at, code, reason },
    });
  });
}

/** A loan's write-off history, oldest first; null if no such loan exists. */
export async function listWriteOffs({
  loanId,
  tenantId,
}: {
  loanId: string;
  tenantId: string;
}): Promise<WriteOff[] | null> {
  const [loan] = await db
    .select({ loanId: loans.loanId })
    .from(loans)
    .where(and(eq(loans.loanId, loanId), eq(loans.tenantId, tenantId)));
  if (!loan) {
    return null;
  }
  const rows = await db
    .select()
    .from(loanWriteOffs)
    .where(eq(loanWriteOffs.loanId, loanId))
    .orderBy(asc(loanWriteOffs.createdAt));
  // Codes were zod-validated at the write boundary, so they always parse.
  return rows.map((row) => ({ ...row, code: row.code as WriteOffCode }));
}
