/**
 * v0/tax-type/routes.ts -- HTTP for /v0/tax-type: creation, listing, get,
 * and deprecate. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { taxTypeIdSchema } from "../../schemas/ids.ts";
import { taxTypeSchema } from "../../schemas/tax-type.ts";
import {
  createTaxType,
  deprecateTaxType,
  getTaxType,
  listTaxTypes,
  taxTypeCreateSchema,
} from "./service.ts";

const createTaxTypeRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Tax type"],
  summary: "Create a tax type",
  request: {
    body: {
      content: { "application/json": { schema: taxTypeCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: taxTypeSchema } },
      description: "Created",
    },
  },
});

const listTaxTypesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tax type"],
  summary: "List tax types",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(taxTypeSchema) } },
      description: "OK",
    },
  },
});

const getTaxTypeRoute = createRoute({
  method: "get",
  path: "/{taxTypeId}",
  tags: ["Tax type"],
  summary: "Get a tax type",
  request: { params: z.object({ taxTypeId: taxTypeIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: taxTypeSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateTaxTypeRoute = createRoute({
  method: "delete",
  path: "/{taxTypeId}",
  tags: ["Tax type"],
  summary: "Deprecate a tax type",
  request: { params: z.object({ taxTypeId: taxTypeIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: taxTypeSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const taxTypeApp = new OpenAPIHono()
  .openapi(createTaxTypeRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTaxType({ taxType: body }), 201);
  })
  .openapi(listTaxTypesRoute, async (c) => {
    return c.json(await listTaxTypes(), 200);
  })
  .openapi(getTaxTypeRoute, async (c) => {
    const taxType = await getTaxType({ taxTypeId: c.req.param("taxTypeId") });
    if (!taxType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taxType, 200);
  })
  .openapi(deprecateTaxTypeRoute, async (c) => {
    const taxType = await deprecateTaxType({
      taxTypeId: c.req.param("taxTypeId"),
    });
    if (!taxType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taxType, 200);
  });
