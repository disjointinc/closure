/**
 * v0/task-type/routes.ts -- HTTP for /v0/task-type: creation, listing, get,
 * and deprecate. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { taskTypeIdSchema } from "../../schemas/ids.ts";
import { taskTypeSchema } from "../../schemas/task-type.ts";
import {
  createTaskType,
  deprecateTaskType,
  getTaskType,
  listTaskTypes,
} from "./service.ts";

const taskTypeCreateSchema = taskTypeSchema.omit({
  taskTypeId: true,
  createdAt: true,
  deprecatedAt: true,
});

export type TaskTypeCreateBody = z.infer<typeof taskTypeCreateSchema>;

const createTaskTypeRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Task type"],
  summary: "Create a task type",
  request: {
    body: {
      content: { "application/json": { schema: taskTypeCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: taskTypeSchema } },
      description: "Created",
    },
  },
});

const listTaskTypesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Task type"],
  summary: "List task types",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(taskTypeSchema) } },
      description: "OK",
    },
  },
});

const getTaskTypeRoute = createRoute({
  method: "get",
  path: "/{taskTypeId}",
  tags: ["Task type"],
  summary: "Get a task type",
  request: { params: z.object({ taskTypeId: taskTypeIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: taskTypeSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateTaskTypeRoute = createRoute({
  method: "delete",
  path: "/{taskTypeId}",
  tags: ["Task type"],
  summary: "Deprecate a task type",
  request: { params: z.object({ taskTypeId: taskTypeIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: taskTypeSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const taskTypeApp = new OpenAPIHono()
  .openapi(createTaskTypeRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTaskType({ taskType: body }), 201);
  })
  .openapi(listTaskTypesRoute, async (c) => {
    return c.json(await listTaskTypes(), 200);
  })
  .openapi(getTaskTypeRoute, async (c) => {
    const taskType = await getTaskType({
      taskTypeId: c.req.param("taskTypeId"),
    });
    if (!taskType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taskType, 200);
  })
  .openapi(deprecateTaskTypeRoute, async (c) => {
    const taskType = await deprecateTaskType({
      taskTypeId: c.req.param("taskTypeId"),
    });
    if (!taskType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taskType, 200);
  });
