import { z } from "zod";
import { epochMs } from "./common.ts";
import { ruleIdSchema, ruleRunIdSchema, tenantIdSchema } from "./ids.ts";
import { firingPayloadSchema } from "./rule.ts";

/**
 * One durable execution of a single rule action for a single firing. Rows
 * are inserted synchronously when a rule fires (the firing is never lost),
 * then drained by the executor worker with retries until succeededAt is set.
 * triggerKey is the idempotency anchor: one row per (rule, tenant,
 * trigger-instance, action), so a re-detected firing inserts nothing.
 */
export const ruleRunSchema = z.object({
  ruleRunId: ruleRunIdSchema,
  createdAt: epochMs,
  ruleId: ruleIdSchema,
  tenantId: tenantIdSchema,
  /** Idempotency key for the firing instance (e.g. "threshold:80000", "first", an invoice id). */
  triggerKey: z.string().min(1),
  /** Index into the rule's actions array. */
  actionIndex: z.number().int().nonnegative(),
  /** The facts the trigger observed at firing time, for template substitution. */
  payload: firingPayloadSchema,
  attempts: z.number().int().nonnegative(),
  /** When the next attempt becomes eligible (backoff + jitter). */
  availableAt: epochMs,
  succeededAt: epochMs.nullable(),
  failedAt: epochMs.nullable(),
  lastError: z.string().nullable(),
});
export type RuleRun = z.infer<typeof ruleRunSchema>;
