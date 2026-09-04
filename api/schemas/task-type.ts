import { z } from "zod";
import { epochMs } from "./common.ts";
import { teamMemberIdSchema, taskTypeIdSchema } from "./ids.ts";

export const integrationSystemSchema = z.enum(["slack", "linear", "jira"]);

/**
 * An external system a task type routes its tasks to. Configuration lives on
 * the type (not per-task) so every instance of the same fundamental task
 * lands in the same place. "slack" posts to a channel; "linear"/"jira" sync
 * a trackable ticket whose handle is stored on the task's externalRefs.
 */
export const integrationTargetSchema = z.discriminatedUnion("system", [
  z.object({
    system: z.literal(integrationSystemSchema.enum.slack),
    channel: z.string().min(1),
  }),
  z.object({
    system: z.literal(integrationSystemSchema.enum.linear),
    teamKey: z.string().min(1),
  }),
  z.object({
    system: z.literal(integrationSystemSchema.enum.jira),
    projectKey: z.string().min(1),
  }),
]);
export type IntegrationTarget = z.infer<typeof integrationTargetSchema>;

/**
 * A category of task (analogous to tax/tax-type): behavior shared across
 * every instance of the same fundamental task -- who it defaults to and
 * which external systems it routes to.
 */
export const taskTypeSchema = z.object({
  taskTypeId: taskTypeIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  defaultAssigneeTeamMemberId: teamMemberIdSchema.nullable(),
  integrations: z.array(integrationTargetSchema).nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type TaskType = z.infer<typeof taskTypeSchema>;
