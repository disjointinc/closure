/**
 * v0/meter/routes.ts -- HTTP for /v0/meter: request validation and wiring.
 * Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { meterIdSchema } from "../../schemas/ids.ts";
import { meterSchema } from "../../schemas/meter.ts";
import {
  createMeter,
  deprecateMeter,
  getMeter,
  listMeters,
} from "./service.ts";

const meterCreateSchema = meterSchema.omit({
  createdAt: true,
  deprecatedAt: true,
  meterId: true,
});

export type MeterCreateBody = z.infer<typeof meterCreateSchema>;

const createMeterRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Meter"],
  summary: "Create a meter",
  request: {
    body: {
      content: { "application/json": { schema: meterCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: meterSchema } },
      description: "Created",
    },
  },
});

const listMetersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Meter"],
  summary: "List meters",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(meterSchema) } },
      description: "OK",
    },
  },
});

const getMeterRoute = createRoute({
  method: "get",
  path: "/{meterId}",
  tags: ["Meter"],
  summary: "Get a meter",
  request: { params: z.object({ meterId: meterIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: meterSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateMeterRoute = createRoute({
  method: "delete",
  path: "/{meterId}",
  tags: ["Meter"],
  summary: "Deprecate a meter",
  request: { params: z.object({ meterId: meterIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: meterSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const meterApp = new OpenAPIHono()
  .openapi(createMeterRoute, async (c) => {
    return c.json(await createMeter({ meter: c.req.valid("json") }), 201);
  })
  .openapi(listMetersRoute, async (c) => {
    return c.json(await listMeters(), 200);
  })
  .openapi(getMeterRoute, async (c) => {
    const meter = await getMeter({ meterId: c.req.param("meterId") });
    if (!meter) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(meter, 200);
  })
  .openapi(deprecateMeterRoute, async (c) => {
    const meter = await deprecateMeter({ meterId: c.req.param("meterId") });
    if (!meter) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(meter, 200);
  });
