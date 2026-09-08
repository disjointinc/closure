/**
 * v0/loan-template/service.ts -- loan template business logic. Templates
 * are reusable loan definitions that loans mint from; they're deprecated,
 * never deleted.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { loanTemplates } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { LoanTemplate } from "../../schemas/loan-template.ts";
import type { LoanTemplateCreateBody } from "./routes.ts";

export async function getLoanTemplate({
  loanTemplateId,
}: {
  loanTemplateId: string;
}): Promise<LoanTemplate | null> {
  const [row] = await db
    .select()
    .from(loanTemplates)
    .where(eq(loanTemplates.loanTemplateId, loanTemplateId));
  if (!row) {
    return null;
  }
  return row;
}

export async function listLoanTemplates(): Promise<LoanTemplate[]> {
  return db.select().from(loanTemplates);
}

export async function createLoanTemplate({
  template,
}: {
  template: LoanTemplateCreateBody;
}): Promise<LoanTemplate> {
  const created: LoanTemplate = {
    ...template,
    loanTemplateId: generateId({ prefix: "loan_template" }),
    createdAt: Date.now(),
    deprecatedAt: null,
  };
  await db.insert(loanTemplates).values(created).onConflictDoNothing();
  return created;
}

/** Deprecate the template, or return null if no such template exists. */
export async function deprecateLoanTemplate({
  loanTemplateId,
}: {
  loanTemplateId: string;
}): Promise<LoanTemplate | null> {
  const updated = await db
    .update(loanTemplates)
    .set({ deprecatedAt: Date.now() })
    .where(eq(loanTemplates.loanTemplateId, loanTemplateId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getLoanTemplate({ loanTemplateId });
}
