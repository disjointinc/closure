/**
 * v0/task-type/service.ts -- task type business logic. Task types are
 * first-class config: created here, referenced by id, and deprecated like
 * other immutable definitions. The external systems a type's tasks route to
 * live here, not on individual tasks.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { taskTypes } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { TaskType } from "../../schemas/task-type.ts";
import type { TaskTypeCreateBody } from "./routes.ts";

export async function listTaskTypes(): Promise<TaskType[]> {
  return db.select().from(taskTypes);
}

export async function getTaskType({
  taskTypeId,
}: {
  taskTypeId: string;
}): Promise<TaskType | null> {
  const [row] = await db
    .select()
    .from(taskTypes)
    .where(eq(taskTypes.taskTypeId, taskTypeId));
  if (!row) {
    return null;
  }
  return row;
}

export async function createTaskType({
  taskType,
}: {
  taskType: TaskTypeCreateBody;
}): Promise<TaskType> {
  const created: TaskType = {
    ...taskType,
    taskTypeId: generateId({ prefix: "task_type" }),
    createdAt: Date.now(),
    deprecatedAt: null,
  };
  await db.insert(taskTypes).values(created).onConflictDoNothing();
  return created;
}

/** Deprecate the task type, or return null if no such task type exists. */
export async function deprecateTaskType({
  taskTypeId,
}: {
  taskTypeId: string;
}): Promise<TaskType | null> {
  const updated = await db
    .update(taskTypes)
    .set({ deprecatedAt: Date.now() })
    .where(eq(taskTypes.taskTypeId, taskTypeId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getTaskType({ taskTypeId });
}
