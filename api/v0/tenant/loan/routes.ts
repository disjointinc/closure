/**
 * v0/tenant/loan/routes.ts -- HTTP for /v0/tenant/:tenantId/loan: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../../lib/http.ts";
import {
  assignmentIdSchema,
  loanIdSchema,
  loanTemplateIdSchema,
  tenantIdSchema,
} from "../../../schemas/ids.ts";
import { installmentSchema } from "../../../schemas/installment.ts";
import { loanDefinitionFields, loanSchema } from "../../../schemas/loan.ts";
import { MAX_LOAN_INSTALLMENTS } from "../../../schemas/loan-servicing.ts";
import {
  writeOffCodeSchema,
  writeOffSchema,
} from "../../../schemas/write-off.ts";
import { LoanServicingError } from "./servicing.ts";
import {
  closeLoan,
  createLoan,
  getLoan,
  listLoans,
  listWriteOffs,
  writeOffLoan,
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

const createLoanRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/loan"],
  summary: "Create a loan",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: loanCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: loanSchema } },
      description: "Created",
    },
    400: invalidResponse,
    404: notFoundResponse,
  },
});

const listLoansRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/loan"],
  summary: "List loans",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(loanSchema) } },
      description: "OK",
    },
  },
});

const getLoanRoute = createRoute({
  method: "get",
  path: "/{loanId}",
  tags: ["tenant/loan"],
  summary: "Get a loan",
  request: {
    params: z.object({ loanId: loanIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: loanSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const closeLoanRoute = createRoute({
  method: "patch",
  path: "/{loanId}/close",
  tags: ["tenant/loan"],
  summary: "Close a loan",
  request: {
    params: z.object({ loanId: loanIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: loanSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const writeOffBodySchema = z.object({
  code: writeOffCodeSchema,
  reason: z.string().nullable(),
});

const writeOffLoanRoute = createRoute({
  method: "patch",
  path: "/{loanId}/write-off",
  tags: ["tenant/loan"],
  summary: "Write off a loan",
  request: {
    params: z.object({ loanId: loanIdSchema, tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: writeOffBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: loanSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const listWriteOffsRoute = createRoute({
  method: "get",
  path: "/{loanId}/write-off",
  tags: ["tenant/loan"],
  summary: "List a loan's write-off history",
  request: {
    params: z.object({ loanId: loanIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(writeOffSchema) } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const loanApp = new OpenAPIHono<{ Variables: { tenantId: string } }>()
  .onError((error, c) => {
    console.error("loan request failed", error);
    if (error instanceof LoanServicingError) {
      return c.json({ code: error.code, error: error.message }, error.status);
    }
    return c.json({ error: "internal server error" }, 500);
  })
  .openapi(createLoanRoute, async (c) => {
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
  .openapi(listLoansRoute, async (c) => {
    return c.json(await listLoans({ tenantId: c.get("tenantId") }), 200);
  })
  .openapi(getLoanRoute, async (c) => {
    const loan = await getLoan({
      loanId: c.req.param("loanId"),
      tenantId: c.get("tenantId"),
    });
    if (!loan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(loan, 200);
  })
  .openapi(closeLoanRoute, async (c) => {
    const loan = await closeLoan({
      loanId: c.req.param("loanId"),
      tenantId: c.get("tenantId"),
    });
    if (!loan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(loan, 200);
  })
  .openapi(writeOffLoanRoute, async (c) => {
    const body = c.req.valid("json");
    const loan = await writeOffLoan({
      code: body.code,
      loanId: c.req.param("loanId"),
      reason: body.reason,
      tenantId: c.get("tenantId"),
    });
    if (!loan) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(loan, 200);
  })
  .openapi(listWriteOffsRoute, async (c) => {
    const writeOffs = await listWriteOffs({
      loanId: c.req.param("loanId"),
      tenantId: c.get("tenantId"),
    });
    if (!writeOffs) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(writeOffs, 200);
  });
