/**
 * v0/cycle/routes.ts -- HTTP for /v0/cycle: creation, listing, get, and
 * deprecate. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";
import {
  createCycle,
  cycleApiSchema,
  cycleCreateSchema,
  deprecateCycle,
  getCycle,
  listCycles,
} from "./service.ts";

const createCycleRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Cycle"],
  summary: "Create a cycle",
  request: {
    body: {
      content: { "application/json": { schema: cycleCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: cycleApiSchema } },
      description: "Created",
    },
  },
});

const listCyclesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Cycle"],
  summary: "List cycles",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(cycleApiSchema) } },
      description: "OK",
    },
  },
});

const getCycleRoute = createRoute({
  method: "get",
  path: "/{cycleId}",
  tags: ["Cycle"],
  summary: "Get a cycle",
  request: { params: z.object({ cycleId: cycleIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: cycleApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateCycleRoute = createRoute({
  method: "delete",
  path: "/{cycleId}",
  tags: ["Cycle"],
  summary: "Deprecate a cycle",
  request: { params: z.object({ cycleId: cycleIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: cycleApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const cycleApp = new OpenAPIHono()
  .openapi(createCycleRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createCycle({ cycle: body }), 201);
  })
  .openapi(listCyclesRoute, async (c) => {
    return c.json(await listCycles(), 200);
  })
  .openapi(getCycleRoute, async (c) => {
    const cycle = await getCycle({ cycleId: c.req.param("cycleId") });
    if (!cycle) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(cycle, 200);
  })
  .openapi(deprecateCycleRoute, async (c) => {
    const cycle = await deprecateCycle({ cycleId: c.req.param("cycleId") });
    if (!cycle) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(cycle, 200);
  });
