/**
 * v0/add-on-type/routes.ts -- HTTP for /v0/add-on-type: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../lib/http.ts";
import { addOnTypeSchema } from "../../schemas/add-on-type.ts";
import { addOnTypeIdSchema, cycleIdSchema } from "../../schemas/ids.ts";
import { valueCreateSchema, valueSchema } from "../../schemas/value.ts";
import {
  createAddOnType,
  deprecateAddOnType,
  getAddOnType,
  listAddOnTypes,
} from "./service.ts";

// The call surface for prices: an existing cycle id plus the owned value
// inline. Cycles are first-class (referenced by id); values are owned by
// the add-on type, so they're always written and read as full objects.
export const addOnTypeApiSchema = addOnTypeSchema.extend({
  prices: z.array(z.object({ cycleId: cycleIdSchema, value: valueSchema })),
});

export type AddOnTypeApi = z.infer<typeof addOnTypeApiSchema>;

/** Create-input: the server mints the add-on type and value ids and stamps times. */
const addOnTypeCreateSchema = addOnTypeSchema
  .omit({ addOnTypeId: true, createdAt: true, deprecatedAt: true })
  .extend({
    prices: z.array(
      z.object({ cycleId: cycleIdSchema, value: valueCreateSchema }),
    ),
  });

export type AddOnTypeCreateBody = z.infer<typeof addOnTypeCreateSchema>;

const createAddOnTypeRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Add-on type"],
  summary: "Create an add-on type",
  request: {
    body: {
      content: { "application/json": { schema: addOnTypeCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: addOnTypeApiSchema } },
      description: "Created",
    },
    400: invalidResponse,
  },
});

const listAddOnTypesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Add-on type"],
  summary: "List add-on types",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(addOnTypeApiSchema) } },
      description: "OK",
    },
  },
});

const getAddOnTypeRoute = createRoute({
  method: "get",
  path: "/{addOnTypeId}",
  tags: ["Add-on type"],
  summary: "Get an add-on type",
  request: { params: z.object({ addOnTypeId: addOnTypeIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: addOnTypeApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateAddOnTypeRoute = createRoute({
  method: "delete",
  path: "/{addOnTypeId}",
  tags: ["Add-on type"],
  summary: "Deprecate an add-on type",
  request: { params: z.object({ addOnTypeId: addOnTypeIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: addOnTypeApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const addOnTypeApp = new OpenAPIHono()
  .openapi(createAddOnTypeRoute, async (c) => {
    const body = c.req.valid("json");
    const addOnType = await createAddOnType({ addOnType: body });
    if ("error" in addOnType) {
      return c.json(addOnType, 400);
    }
    return c.json(addOnType, 201);
  })
  .openapi(listAddOnTypesRoute, async (c) => {
    return c.json(await listAddOnTypes(), 200);
  })
  .openapi(getAddOnTypeRoute, async (c) => {
    const addOnType = await getAddOnType({
      addOnTypeId: c.req.param("addOnTypeId"),
    });
    if (!addOnType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOnType, 200);
  })
  .openapi(deprecateAddOnTypeRoute, async (c) => {
    const addOnType = await deprecateAddOnType({
      addOnTypeId: c.req.param("addOnTypeId"),
    });
    if (!addOnType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOnType, 200);
  });
