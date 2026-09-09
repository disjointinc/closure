/**
 * v0/loan-template/routes.ts -- HTTP for /v0/loan-template: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
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

export const loanTemplateApp = new Hono()
  .post("/", zValidator("json", loanTemplateCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createLoanTemplate({ template: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listLoanTemplates());
  })
  .get(
    "/:loanTemplateId",
    zValidator("param", z.object({ loanTemplateId: loanTemplateIdSchema })),
    async (c) => {
      const template = await getLoanTemplate({
        loanTemplateId: c.req.param("loanTemplateId"),
      });
      if (!template) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(template);
    },
  )
  .delete(
    "/:loanTemplateId",
    zValidator("param", z.object({ loanTemplateId: loanTemplateIdSchema })),
    async (c) => {
      const template = await deprecateLoanTemplate({
        loanTemplateId: c.req.param("loanTemplateId"),
      });
      if (!template) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(template);
    },
  );
