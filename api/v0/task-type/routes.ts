/**
 * v0/task-type/routes.ts -- HTTP for /v0/task-type: creation, listing, get,
 * and deprecate. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
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

export const taskTypeApp = new Hono()
  .post("/", zValidator("json", taskTypeCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTaskType({ taskType: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listTaskTypes());
  })
  .get("/:taskTypeId", async (c) => {
    const taskType = await getTaskType({
      taskTypeId: c.req.param("taskTypeId"),
    });
    if (!taskType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taskType);
  })
  .delete("/:taskTypeId", async (c) => {
    const taskType = await deprecateTaskType({
      taskTypeId: c.req.param("taskTypeId"),
    });
    if (!taskType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taskType);
  });
