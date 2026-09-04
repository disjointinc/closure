/**
 * cache/rule/execute.ts -- execute rule actions and drain due rule_runs.
 *
 * Firings are written synchronously by the evaluator (cache/rule/evaluate.ts)
 * and never lost; this file is the at-least-once executor. The loop claims
 * due rows, runs the action, and marks success or schedules a retry with
 * exponential backoff + jitter. A row exhausts retries into failed_at (kept
 * for the audit log) so one poison action can't block the queue.
 *
 * Executors are idempotent where the underlying operation is, and throw on
 * transient failure so the worker retries. retry_payment records intent and
 * logs: the Stripe retry wiring lands with the payment lifecycle engine.
 */
import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { invoices, items, ruleRuns, rules, values } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { FiringPayload, RuleAction } from "../../schemas/rule.ts";
import { createTaskNotifying } from "./task-notify.ts";

export type ExecutionTarget = {
  ruleRunId: string;
  ruleId: string;
  tenantId: string;
  actionIndex: number;
  /** The facts the trigger observed at firing time. */
  payload: FiringPayload;
};

/**
 * The substitution map for a create_task template: tenantId (always, from
 * the run) plus the payload's fields. Numbers become strings only here, at
 * the text boundary.
 */
function substitutions({
  payload,
  tenantId,
}: {
  payload: FiringPayload;
  tenantId: string;
}): Record<string, string> {
  const out: Record<string, string> = { tenantId };
  if ("meterId" in payload) {
    out.meterId = payload.meterId;
  }
  if (payload.type === "microcredits_remaining") {
    out.balanceMicrocredits = String(payload.balanceMicrocredits);
    out.thresholdMicrocredits = String(payload.thresholdMicrocredits);
  }
  if (payload.type === "microcredits_spent") {
    out.spentMicrocredits = String(payload.spentMicrocredits);
    out.thresholdMicrocredits = String(payload.thresholdMicrocredits);
  }
  if (payload.type === "relative_to_lifecycle_event") {
    out.invoiceId = payload.invoiceId;
  }
  return out;
}

/** create_task: create the internal task (routes to the type's integrations). */
async function executeCreateTask({
  action,
  target,
}: {
  action: Extract<RuleAction, { type: "create_task" }>;
  target: ExecutionTarget;
}): Promise<void> {
  // Substitute {{placeholder}}s with the firing's values; null stays null for
  // the optional description so it doesn't become an empty string.
  const valuesByName = substitutions({
    payload: target.payload,
    tenantId: target.tenantId,
  });
  const substitute = (template: string | null): string | null =>
    template === null
      ? null
      : template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
          name in valuesByName ? valuesByName[name] : match,
        );
  await createTaskNotifying({
    tenantId: target.tenantId,
    task: {
      taskId: generateId({ prefix: "task" }),
      createdAt: Date.now(),
      taskTypeId: action.taskTypeId,
      sourceRuleId: target.ruleId,
      title: substitute(action.title) ?? "",
      description: substitute(action.description),
      assignedToTeamMemberId: action.assignToTeamMemberId,
    },
  });
}

/** add_invoice_item: append a charge to the tenant's open (unclosed) invoice. */
async function executeAddInvoiceItem({
  action,
  target,
}: {
  action: Extract<RuleAction, { type: "add_invoice_item" }>;
  target: ExecutionTarget;
}): Promise<void> {
  const [open] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.tenantId, target.tenantId))
    .orderBy(invoices.createdAt)
    .limit(1);
  if (!open || open.closedAt !== null) {
    throw new Error(`no open invoice for tenant ${target.tenantId}`);
  }
  const valueId = action.fixedValueId;
  if (valueId === null) {
    // Percentage-of-invoice fees resolve to a computed value at execution.
    // Until invoice totals are computed, a percentage-only fee is unsupported.
    throw new Error("percentage_of_invoice fees are not yet supported");
  }
  const [value] = await db
    .select()
    .from(values)
    .where(eq(values.valueId, valueId));
  if (!value) {
    throw new Error(`invoice-item value ${valueId} not found`);
  }
  await db
    .insert(items)
    .values({
      itemId: generateId({ prefix: "item" }),
      invoiceId: open.invoiceId,
      perUnitValueId: valueId,
      units: 1,
      name: `Late fee (${target.ruleId})`,
      description: null,
    })
    .onConflictDoNothing();
}

/** retry_payment: record retry intent; the payment engine wires Stripe. */
async function executeRetryPayment({
  action,
  target,
}: {
  action: Extract<RuleAction, { type: "retry_payment" }>;
  target: ExecutionTarget;
}): Promise<void> {
  // TODO: call stripe
  console.log("payment retry requested", {
    notes: action.notes,
    ruleId: target.ruleId,
    tenantId: target.tenantId,
  });
}

/** Execute the action at target.actionIndex for the firing's rule. */
export async function executeRuleRun({
  target,
}: {
  target: ExecutionTarget;
}): Promise<void> {
  const [rule] = await db
    .select()
    .from(rules)
    .where(eq(rules.ruleId, target.ruleId));
  if (!rule) {
    throw new Error(`rule ${target.ruleId} not found`);
  }
  const action = rule.actions[target.actionIndex];
  if (!action) {
    throw new Error(
      `rule ${target.ruleId} has no action at index ${target.actionIndex}`,
    );
  }
  switch (action.type) {
    case "create_task":
      await executeCreateTask({ action, target });
      return;
    case "add_invoice_item":
      await executeAddInvoiceItem({ action, target });
      return;
    case "retry_payment":
      await executeRetryPayment({ action, target });
      return;
    default: {
      // Defensive: an unknown action type must surface, not silently pass.
      const exhaustive: never = action;
      throw new Error(`unknown rule action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** How many due runs to claim per tick. */
const CLAIM_BATCH = 100;
/** Retry backoff (ms) by attempt; each gets full jitter. */
const RETRY_BACKOFF_MS = [1_000, 5_000, 30_000, 5 * 60_000];
/** Attempts after which a run is marked failed (no longer retried). */
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * Next eligible time with full jitter on the backoff, so a burst of failures
 * doesn't retry in lockstep (thundering herd).
 */
function nextAvailableAt({ attempts }: { attempts: number }): number {
  const backoff =
    RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)];
  return Date.now() + Math.floor(Math.random() * backoff);
}

/** Drain due rule_runs, executing each action. Returns the count handled. */
export async function executeDueRuleRuns(): Promise<number> {
  const due = await db
    .select()
    .from(ruleRuns)
    .where(
      and(
        isNull(ruleRuns.succeededAt),
        isNull(ruleRuns.failedAt),
        lte(ruleRuns.availableAt, Date.now()),
      ),
    )
    .limit(CLAIM_BATCH);
  for (const run of due) {
    try {
      await executeRuleRun({
        target: {
          ruleRunId: run.ruleRunId,
          ruleId: run.ruleId,
          tenantId: run.tenantId,
          actionIndex: run.actionIndex,
          payload: run.payload,
        },
      });
      await db
        .update(ruleRuns)
        .set({ succeededAt: Date.now(), lastError: null })
        .where(eq(ruleRuns.ruleRunId, run.ruleRunId));
    } catch (error) {
      const attempts = run.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attempts >= MAX_ATTEMPTS;
      await db
        .update(ruleRuns)
        .set({
          attempts,
          availableAt: nextAvailableAt({ attempts }),
          failedAt: exhausted ? Date.now() : null,
          lastError: message,
        })
        .where(eq(ruleRuns.ruleRunId, run.ruleRunId));
      console.error("rule run failed", {
        attempts,
        error,
        exhausted,
        ruleId: run.ruleId,
        ruleRunId: run.ruleRunId,
        tenantId: run.tenantId,
      });
    }
  }
  return due.length;
}

const EXECUTOR_INTERVAL_MS = 1_000;

/**
 * Start the executor loop. Interval is unref'd and errors are logged, never
 * thrown -- a failed tick just defers execution to the next one.
 */
export function startRuleExecutorLoop(): void {
  const executor = setInterval(() => {
    executeDueRuleRuns().catch((error) =>
      console.error("rule executor tick failed", error),
    );
  }, EXECUTOR_INTERVAL_MS);
  executor.unref();
}
