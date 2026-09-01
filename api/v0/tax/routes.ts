/**
 * v0/tax/routes.ts -- HTTP for /v0/tax: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { taxSchema } from "../../schemas/tax.ts";
import { taxTypeRefSchema } from "../tax-type/service.ts";
import { createTax, deprecateTax, getTax, listTaxes } from "./service.ts";

const taxCreateSchema = z.object({
  ...taxSchema.shape,
  taxTypeId: taxTypeRefSchema,
});

export type TaxCreateBody = z.infer<typeof taxCreateSchema>;

export const taxApp = new Hono()
  .post("/", zValidator("json", taxCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTax({ tax: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listTaxes());
  })
  .get("/:taxId", async (c) => {
    const tax = await getTax({ taxId: c.req.param("taxId") });
    if (!tax) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tax);
  })
  .delete("/:taxId", async (c) => {
    const tax = await deprecateTax({ taxId: c.req.param("taxId") });
    if (!tax) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tax);
  });
