/**
 * v0/tenant/task/routes.ts -- HTTP for /v0/tenant/:tenantId/task: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../../lib/http.ts";
import {
  ruleIdSchema,
  taskIdSchema,
  taskTypeIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "../../../schemas/ids.ts";
import { taskSchema } from "../../../schemas/task.ts";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  patchTask,
} from "./service.ts";

// The server mints the task id and stamps createdAt.
const taskCreateSchema = z.object({
  taskTypeId: taskTypeIdSchema,
  sourceRuleId: ruleIdSchema.nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  assignedToTeamMemberId: teamMemberIdSchema.nullable(),
});

const taskPatchSchema = z.object({
  assignedToTeamMemberId: teamMemberIdSchema.nullable(),
});

export type TaskCreateBody = z.infer<typeof taskCreateSchema>;
export type TaskPatchBody = z.infer<typeof taskPatchSchema>;

const createTaskRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/task"],
  summary: "Create a task",
  request: {
    body: {
      content: { "application/json": { schema: taskCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: taskSchema } },
      description: "Created",
    },
  },
});

const listTasksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/task"],
  summary: "List tasks",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(taskSchema) } },
      description: "OK",
    },
  },
});

const getTaskRoute = createRoute({
  method: "get",
  path: "/{taskId}",
  tags: ["tenant/task"],
  summary: "Get a task",
  request: {
    params: z.object({ taskId: taskIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: taskSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const patchTaskRoute = createRoute({
  method: "patch",
  path: "/{taskId}",
  tags: ["tenant/task"],
  summary: "Patch a task",
  request: {
    params: z.object({ taskId: taskIdSchema, tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: taskPatchSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: taskSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const completeTaskRoute = createRoute({
  method: "post",
  path: "/{taskId}/complete",
  tags: ["tenant/task"],
  summary: "Complete a task",
  request: {
    params: z.object({ taskId: taskIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: taskSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deleteTaskRoute = createRoute({
  method: "delete",
  path: "/{taskId}",
  tags: ["tenant/task"],
  summary: "Delete a task",
  request: {
    params: z.object({ taskId: taskIdSchema, tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: taskSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const taskApp = new OpenAPIHono<{ Variables: { tenantId: string } }>()
  .openapi(createTaskRoute, async (c) => {
    const task = await createTask({
      tenantId: c.get("tenantId"),
      task: c.req.valid("json"),
    });
    return c.json(task, 201);
  })
  .openapi(listTasksRoute, async (c) => {
    return c.json(await listTasks({ tenantId: c.get("tenantId") }), 200);
  })
  .openapi(getTaskRoute, async (c) => {
    const task = await getTask({ taskId: c.req.param("taskId") });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task, 200);
  })
  .openapi(patchTaskRoute, async (c) => {
    const task = await patchTask({
      patch: c.req.valid("json"),
      taskId: c.req.param("taskId"),
    });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task, 200);
  })
  .openapi(completeTaskRoute, async (c) => {
    const task = await completeTask({ taskId: c.req.param("taskId") });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task, 200);
  })
  .openapi(deleteTaskRoute, async (c) => {
    const task = await deleteTask({ taskId: c.req.param("taskId") });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task, 200);
  });
