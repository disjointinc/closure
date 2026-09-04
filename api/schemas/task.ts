import { z } from "zod";
import { epochMs } from "./common.ts";
import {
  ruleIdSchema,
  taskIdSchema,
  taskTypeIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "./ids.ts";
import { integrationSystemSchema } from "./task-type.ts";

/**
 * A handle to a task's counterpart in an external tracking system (Linear,
 * Jira, ...), used for bidirectional sync. Set by the integration, not the
 * caller.
 */
export const externalRefSchema = z.object({
  system: integrationSystemSchema,
  externalId: z.string().min(1),
});
export type ExternalRef = z.infer<typeof externalRefSchema>;

/**
 * An internal action item. Tasks are operational data, so they're deleted
 * (deletedAt), not deprecated. sourceRuleId links a rule-generated task back
 * to the rule that created it; null means manually created.
 */
export const taskSchema = z.object({
  taskId: taskIdSchema,
  createdAt: epochMs,
  deletedAt: epochMs.nullable(),
  taskTypeId: taskTypeIdSchema,
  tenantId: tenantIdSchema,
  sourceRuleId: ruleIdSchema.nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  assignedToTeamMemberId: teamMemberIdSchema.nullable(),
  completedAt: epochMs.nullable(),
  externalRefs: z.array(externalRefSchema).nullable(),
});
export type Task = z.infer<typeof taskSchema>;
