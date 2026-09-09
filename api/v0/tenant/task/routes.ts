/**
 * v0/tenant/task/routes.ts -- HTTP for /v0/tenant/:tenantId/task: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  ruleIdSchema,
  taskTypeIdSchema,
  teamMemberIdSchema,
} from "../../../schemas/ids.ts";
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

export const taskApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", taskCreateSchema), async (c) => {
    const task = await createTask({
      tenantId: c.get("tenantId"),
      task: c.req.valid("json"),
    });
    return c.json(task, 201);
  })
  .get("/", async (c) => {
    return c.json(await listTasks({ tenantId: c.get("tenantId") }));
  })
  .get("/:taskId", async (c) => {
    const task = await getTask({ taskId: c.req.param("taskId") });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task);
  })
  .patch("/:taskId", zValidator("json", taskPatchSchema), async (c) => {
    const task = await patchTask({
      patch: c.req.valid("json"),
      taskId: c.req.param("taskId"),
    });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task);
  })
  .post("/:taskId/complete", async (c) => {
    const task = await completeTask({ taskId: c.req.param("taskId") });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task);
  })
  .delete("/:taskId", async (c) => {
    const task = await deleteTask({ taskId: c.req.param("taskId") });
    if (!task) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(task);
  });
