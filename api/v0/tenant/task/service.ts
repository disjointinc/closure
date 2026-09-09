/**
 * v0/tenant/task/service.ts -- task business logic. Tasks are tenant-scoped
 * operational data: created manually or by a rule (sourceRuleId), completed,
 * and deleted. Creation and external integration routing (Slack, Linear,
 * ...) live in api/cache/task-notify.ts; this file is the HTTP-facing
 * wrapper for the task routes.
 */
import { desc, eq } from "drizzle-orm";
import {
  createTaskNotifying,
  deliverTaskNotification,
} from "../../../cache/rule/task-notify.ts";
import { db } from "../../../db/index.ts";
import { tasks, taskTypes } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { Task } from "../../../schemas/task.ts";
import type { TaskCreateBody, TaskPatchBody } from "./routes.ts";

export async function listTasks({
  tenantId,
}: {
  tenantId: string;
}): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .orderBy(desc(tasks.createdAt));
}

export async function getTask({
  taskId,
}: {
  taskId: string;
}): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.taskId, taskId));
  if (!row) {
    return null;
  }
  return row;
}

/** Create a task and notify the type's integrations (see cache/task-notify). */
export async function createTask({
  tenantId,
  task,
}: {
  tenantId: string;
  task: TaskCreateBody;
}): Promise<Task> {
  return createTaskNotifying({
    tenantId,
    task: {
      ...task,
      taskId: generateId({ prefix: "task" }),
      createdAt: Date.now(),
    },
  });
}

/** Patch assignment, or return null if no such task exists. */
export async function patchTask({
  patch,
  taskId,
}: {
  patch: TaskPatchBody;
  taskId: string;
}): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({ assignedToTeamMemberId: patch.assignedToTeamMemberId })
    .where(eq(tasks.taskId, taskId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  const task = updated[0];
  const [type] = await db
    .select()
    .from(taskTypes)
    .where(eq(taskTypes.taskTypeId, task.taskTypeId));
  if (type) {
    await deliverTaskNotification({ event: "assigned", task, type });
  }
  return task;
}

/** Complete the task, or return null if no such task exists. */
export async function completeTask({
  taskId,
}: {
  taskId: string;
}): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({ completedAt: Date.now() })
    .where(eq(tasks.taskId, taskId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  const task = updated[0];
  const [type] = await db
    .select()
    .from(taskTypes)
    .where(eq(taskTypes.taskTypeId, task.taskTypeId));
  if (type) {
    await deliverTaskNotification({ event: "completed", task, type });
  }
  return task;
}

/** Delete the task, or return null if no such task exists. */
export async function deleteTask({
  taskId,
}: {
  taskId: string;
}): Promise<Task | null> {
  const updated = await db
    .update(tasks)
    .set({ deletedAt: Date.now() })
    .where(eq(tasks.taskId, taskId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return updated[0];
}
