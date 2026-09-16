/**
 * v0/tax/routes.ts -- HTTP for /v0/tax: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { taxIdSchema } from "../../schemas/ids.ts";
import { taxSchema } from "../../schemas/tax.ts";
import { createTax, deprecateTax, getTax, listTaxes } from "./service.ts";

const taxCreateSchema = taxSchema.omit({
  createdAt: true,
  deprecatedAt: true,
  taxId: true,
});

export type TaxCreateBody = z.infer<typeof taxCreateSchema>;

const createTaxRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tax"],
  summary: "Create a tax",
  request: {
    body: {
      content: { "application/json": { schema: taxCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: taxSchema } },
      description: "Created",
    },
  },
});

const listTaxesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tax"],
  summary: "List taxes",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(taxSchema) } },
      description: "OK",
    },
  },
});

const getTaxRoute = createRoute({
  method: "get",
  path: "/{taxId}",
  tags: ["Tax"],
  summary: "Get a tax",
  request: { params: z.object({ taxId: taxIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: taxSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateTaxRoute = createRoute({
  method: "delete",
  path: "/{taxId}",
  tags: ["Tax"],
  summary: "Deprecate a tax",
  request: { params: z.object({ taxId: taxIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: taxSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const taxApp = new OpenAPIHono()
  .openapi(createTaxRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTax({ tax: body }), 201);
  })
  .openapi(listTaxesRoute, async (c) => {
    return c.json(await listTaxes(), 200);
  })
  .openapi(getTaxRoute, async (c) => {
    const tax = await getTax({ taxId: c.req.param("taxId") });
    if (!tax) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tax, 200);
  })
  .openapi(deprecateTaxRoute, async (c) => {
    const tax = await deprecateTax({ taxId: c.req.param("taxId") });
    if (!tax) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tax, 200);
  });
