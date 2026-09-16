/**
 * v0/loan-template/routes.ts -- HTTP for /v0/loan-template: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { loanTemplateIdSchema } from "../../schemas/ids.ts";
import { loanDefinitionFields } from "../../schemas/loan.ts";
import { loanTemplateSchema } from "../../schemas/loan-template.ts";
import {
  createLoanTemplate,
  deprecateLoanTemplate,
  getLoanTemplate,
  listLoanTemplates,
} from "./service.ts";

const loanTemplateCreateSchema = loanTemplateSchema
  .omit({
    loanTemplateId: true,
    createdAt: true,
    deprecatedAt: true,
  })
  .extend(loanDefinitionFields)
  .strict()
  .refine((template) => {
    const repayment = template.servicingTerms.repayment;
    if (repayment.type !== "periodic_minimum") {
      return true;
    }
    const amount =
      repayment.minimum.type === "fixed"
        ? repayment.minimum.amount
        : repayment.minimum.floor;
    return (
      amount.currency === template.principal.currency &&
      amount.unit === template.principal.unit
    );
  }, "minimum amount/floor must use the principal currency and unit");

export type LoanTemplateCreateBody = z.infer<typeof loanTemplateCreateSchema>;

const createLoanTemplateRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Loan template"],
  summary: "Create a loan template",
  request: {
    body: {
      content: { "application/json": { schema: loanTemplateCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: loanTemplateSchema } },
      description: "Created",
    },
  },
});

const listLoanTemplatesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Loan template"],
  summary: "List loan templates",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(loanTemplateSchema) } },
      description: "OK",
    },
  },
});

const getLoanTemplateRoute = createRoute({
  method: "get",
  path: "/{loanTemplateId}",
  tags: ["Loan template"],
  summary: "Get a loan template",
  request: { params: z.object({ loanTemplateId: loanTemplateIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: loanTemplateSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateLoanTemplateRoute = createRoute({
  method: "delete",
  path: "/{loanTemplateId}",
  tags: ["Loan template"],
  summary: "Deprecate a loan template",
  request: { params: z.object({ loanTemplateId: loanTemplateIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: loanTemplateSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const loanTemplateApp = new OpenAPIHono()
  .openapi(createLoanTemplateRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createLoanTemplate({ template: body }), 201);
  })
  .openapi(listLoanTemplatesRoute, async (c) => {
    return c.json(await listLoanTemplates(), 200);
  })
  .openapi(getLoanTemplateRoute, async (c) => {
    const template = await getLoanTemplate({
      loanTemplateId: c.req.param("loanTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template, 200);
  })
  .openapi(deprecateLoanTemplateRoute, async (c) => {
    const template = await deprecateLoanTemplate({
      loanTemplateId: c.req.param("loanTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template, 200);
  });
