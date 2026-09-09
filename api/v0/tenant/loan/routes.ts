/**
 * v0/tenant/loan/routes.ts -- HTTP for /v0/tenant/:tenantId/loan: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  assignmentIdSchema,
  loanIdSchema,
  loanTemplateIdSchema,
  tenantIdSchema,
} from "../../../schemas/ids.ts";
import { installmentSchema } from "../../../schemas/installment.ts";
import { loanDefinitionFields } from "../../../schemas/loan.ts";
import { MAX_LOAN_INSTALLMENTS } from "../../../schemas/loan-servicing.ts";
import { LoanServicingError } from "./servicing.ts";
import {
  closeLoan,
  createLoan,
  deleteLoan,
  getLoan,
  listLoans,
} from "./service.ts";

export { MAX_LOAN_INSTALLMENTS } from "../../../schemas/loan-servicing.ts";

const installmentCreateSchema = installmentSchema.pick({
  amount: true,
  dueAt: true,
});

/* Loans belong to the tenant directly: assignmentId links the loan to the
 * assignment it funds, if any. The body carries the definition (inline, or
 * a template to copy) plus the installment schedule, if any. */
const loanCreateSchema = z.union([
  // Inline definition.
  z
    .object({
      assignmentId: assignmentIdSchema.nullable(),
      loanTemplateId: z.null(),
      ...loanDefinitionFields,
      installments: z.array(installmentCreateSchema).max(MAX_LOAN_INSTALLMENTS),
    })
    .strict(),
  // From a template: the definition is copied from the template at creation,
  // so definitional fields are not accepted. (Strict: otherwise zod would
  // silently strip them.)
  z
    .object({
      assignmentId: assignmentIdSchema.nullable(),
      loanTemplateId: loanTemplateIdSchema,
      installments: z.array(installmentCreateSchema).max(MAX_LOAN_INSTALLMENTS),
    })
    .strict(),
]);

export type LoanCreateBody = z.infer<typeof loanCreateSchema>;

export const loanApp = new Hono<{ Variables: { tenantId: string } }>()
  .onError((error, c) => {
    console.error("loan request failed", error);
    if (error instanceof LoanServicingError) {
      return c.json({ code: error.code, error: error.message }, error.status);
    }
    return c.json({ error: "internal server error" }, 500);
  })
  .use("*", zValidator("param", z.object({ tenantId: tenantIdSchema })))
  .use("/:loanId/*", zValidator("param", z.object({ loanId: loanIdSchema })))
  .post("/", zValidator("json", loanCreateSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    const loan = await createLoan({ loan: body, tenantId });
    if (!loan) {
      return c.json({ error: "tenant, assignment or template not found" }, 404);
    }
    if ("error" in loan) {
      return c.json(loan, 400);
    }
    return c.json(loan, 201);
  })
  .get("/", async (c) => {
    return c.json(await listLoans({ tenantId: c.get("tenantId") }));
  })
  .get(
    "/:loanId",
    zValidator(
      "param",
      z.object({ loanId: loanIdSchema, tenantId: tenantIdSchema }),
    ),
    async (c) => {
      const loan = await getLoan({
        loanId: c.req.param("loanId"),
        tenantId: c.get("tenantId"),
      });
      if (!loan) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(loan);
    },
  )
  .patch(
    "/:loanId/close",
    zValidator(
      "param",
      z.object({ loanId: loanIdSchema, tenantId: tenantIdSchema }),
    ),
    async (c) => {
      const loan = await closeLoan({
        loanId: c.req.param("loanId"),
        tenantId: c.get("tenantId"),
      });
      if (!loan) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(loan);
    },
  )
  .delete(
    "/:loanId",
    zValidator(
      "param",
      z.object({ loanId: loanIdSchema, tenantId: tenantIdSchema }),
    ),
    async (c) => {
      const loan = await deleteLoan({
        loanId: c.req.param("loanId"),
        tenantId: c.get("tenantId"),
      });
      if (!loan) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(loan);
    },
  );
