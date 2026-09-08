/**
 * v0/loan-template/routes.ts -- HTTP for /v0/loan-template: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { z } from "zod";
import { loanTemplateSchema } from "../../schemas/loan-template.ts";
import {
  createLoanTemplate,
  deprecateLoanTemplate,
  getLoanTemplate,
  listLoanTemplates,
} from "./service.ts";

const loanTemplateCreateSchema = loanTemplateSchema.omit({
  loanTemplateId: true,
  createdAt: true,
  deprecatedAt: true,
});

export type LoanTemplateCreateBody = z.infer<typeof loanTemplateCreateSchema>;

export const loanTemplateApp = new Hono()
  .post("/", zValidator("json", loanTemplateCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createLoanTemplate({ template: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listLoanTemplates());
  })
  .get("/:loanTemplateId", async (c) => {
    const template = await getLoanTemplate({
      loanTemplateId: c.req.param("loanTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template);
  })
  .delete("/:loanTemplateId", async (c) => {
    const template = await deprecateLoanTemplate({
      loanTemplateId: c.req.param("loanTemplateId"),
    });
    if (!template) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(template);
  });
