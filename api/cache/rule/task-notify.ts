/**
 * cache/task-notify.ts -- task creation and external integration delivery.
 *
 * Lives in the machinery layer (not v0) because the rule executor
 * (cache/rule/execute.ts) must create and notify tasks without importing
 * from the route layer: cache and db are strict dependencies of v0, never
 * the reverse. v0/tenant/task/service.ts is the thin HTTP wrapper over
 * createTaskNotifying.
 *
 * Delivery is best-effort: failures are logged, never thrown, so a down
 * integration can't block task operations. Slack posts via an incoming
 * webhook; Linear/Jira ticket sync lands here as additional cases.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { tasks, taskTypes } from "../../db/schema.ts";
import type { Task } from "../../schemas/task.ts";
import type { TaskType } from "../../schemas/task-type.ts";

export type TaskEvent = "created" | "assigned" | "completed";

function renderMessage({
  event,
  task,
}: {
  event: TaskEvent;
  task: Task;
}): string {
  const verb =
    event === "created"
      ? "New task"
      : event === "assigned"
        ? "Task assigned"
        : "Task completed";
  return `${verb}: ${task.title} (tenant ${task.tenantId})`;
}

/** Post to a Slack incoming webhook. The webhook URL is per-channel config. */
async function deliverSlack({
  channel,
  message,
}: {
  channel: string;
  message: string;
}): Promise<void> {
  const webhookUrl = process.env[`CLOSURE_SLACK_WEBHOOK_${channel}`];
  if (!webhookUrl) {
    console.error("no Slack webhook configured for channel", { channel });
    return;
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  if (!response.ok) {
    console.error("Slack delivery failed", {
      channel,
      status: response.status,
    });
  }
}

export async function deliverTaskNotification({
  event,
  task,
  type,
}: {
  event: TaskEvent;
  task: Task;
  type: TaskType;
}): Promise<void> {
  const message = renderMessage({ event, task });
  for (const target of type.integrations) {
    try {
      if (target.system === "slack") {
        await deliverSlack({ channel: target.channel, message });
      }
      // linear/jira ticket sync lands here as additional cases.
    } catch (error) {
      console.error("task integration delivery failed", {
        error,
        event,
        system: target.system,
        taskId: task.taskId,
      });
    }
  }
}

/** The fields needed to create a task (the route body or a rule action). */
export type TaskCreateInput = {
  taskId: string;
  createdAt: number;
  taskTypeId: string;
  sourceRuleId: string | null;
  title: string;
  description: string | null;
  assignedToTeamMemberId: string | null;
};

/**
 * Create a task and notify the type's external integrations. Resolves the
 * assignee from the type's default when not set explicitly. The single
 * canonical create path: both the task route and the rule executor call it.
 */
export async function createTaskNotifying({
  tenantId,
  task,
}: {
  tenantId: string;
  task: TaskCreateInput;
}): Promise<Task> {
  const [type] = await db
    .select()
    .from(taskTypes)
    .where(eq(taskTypes.taskTypeId, task.taskTypeId));
  const assignedToTeamMemberId =
    task.assignedToTeamMemberId ?? type?.defaultAssigneeTeamMemberId ?? null;
  const row: Task = {
    ...task,
    tenantId,
    assignedToTeamMemberId,
    deletedAt: null,
    completedAt: null,
    externalRefs: [],
  };
  await db.insert(tasks).values(row).onConflictDoNothing();
  if (type) {
    await deliverTaskNotification({ event: "created", task: row, type });
  }
  return row;
}
