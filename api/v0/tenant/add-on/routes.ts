/**
 * v0/tenant/add-on/routes.ts -- HTTP for /v0/tenant/:tenantId/add-on: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../../lib/http.ts";
import { addOnSchema } from "../../../schemas/add-on.ts";
import { epochMs } from "../../../schemas/common.ts";
import {
  addOnIdSchema,
  addOnTypeIdSchema,
  assignmentIdSchema,
  tenantIdSchema,
} from "../../../schemas/ids.ts";
import { attachAddOn, deleteAddOn, getAddOn, listAddOns } from "./service.ts";

/* A tenant may hold several open assignments, so the attach target is
 * explicit. */
const addOnCreateSchema = z.object({
  addOnTypeId: addOnTypeIdSchema,
  assignmentId: assignmentIdSchema,
  startsAt: epochMs.nullable(),
  endsAt: epochMs.nullable(),
});

export type AddOnCreateBody = z.infer<typeof addOnCreateSchema>;

const attachAddOnRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/add-on"],
  summary: "Attach an add-on",
  request: {
    body: {
      content: { "application/json": { schema: addOnCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: addOnSchema } },
      description: "Created",
    },
    404: notFoundResponse,
  },
});

const listAddOnsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/add-on"],
  summary: "List add-ons",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(addOnSchema) } },
      description: "OK",
    },
  },
});

const getAddOnRoute = createRoute({
  method: "get",
  path: "/{addOnId}",
  tags: ["tenant/add-on"],
  summary: "Get an add-on",
  request: {
    params: z.object({ addOnId: addOnIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: addOnSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deleteAddOnRoute = createRoute({
  method: "delete",
  path: "/{addOnId}",
  tags: ["tenant/add-on"],
  summary: "Delete an add-on",
  request: {
    params: z.object({ addOnId: addOnIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: addOnSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const addOnApp = new OpenAPIHono<{ Variables: { tenantId: string } }>()
  .openapi(attachAddOnRoute, async (c) => {
    const addOn = await attachAddOn({
      addOn: c.req.valid("json"),
      tenantId: c.get("tenantId"),
    });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn, 201);
  })
  .openapi(listAddOnsRoute, async (c) => {
    return c.json(await listAddOns({ tenantId: c.get("tenantId") }), 200);
  })
  .openapi(getAddOnRoute, async (c) => {
    const addOn = await getAddOn({ addOnId: c.req.param("addOnId") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn, 200);
  })
  .openapi(deleteAddOnRoute, async (c) => {
    const addOn = await deleteAddOn({ addOnId: c.req.param("addOnId") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn, 200);
  });
