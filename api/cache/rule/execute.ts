/**
 * cache/rule/execute.ts -- execute rule actions and drain due rule_runs.
 *
 * Firings are written synchronously by the evaluator (cache/rule/evaluate.ts)
 * and never lost; this file is the at-least-once executor. The loop claims
 * due rows atomically (UPDATE ... FOR UPDATE SKIP LOCKED), so every worker
 * process and overlapping tick gets a disjoint batch -- no double execution
 * from concurrent claimants. Executed work then finalizes each row outside
 * the claim transaction. Outputs are idempotent against the crash window
 * between execution and finalization: task/item ids derive deterministically
 * from the rule_run row, so a lease-expired re-execution is a no-op insert.
 *
 * A row exhausts retries into failed_at (kept for the audit log) so one
 * poison action can't block the queue.
 *
 * Executors are idempotent where the underlying operation is, and throw on
 * transient failure so the worker retries. retry_payment records intent and
 * logs: the Stripe retry wiring lands with the payment lifecycle engine.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { invoices, items, ruleRuns, rules, values } from "../../db/schema.ts";
import { idSuffixLengths } from "../../schemas/ids.ts";
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

/* Derive a deterministic task/item id from the rule_run id: the run row
 * is the idempotency anchor, so a lease-expired re-execution after a
 * mid-run crash inserts nothing instead of minting a duplicate. Slice the
 * run's suffix to the target prefix's length -- both ids share the same
 * alphabet, and the slice preserves uniqueness since the source suffix is
 * already unique and longer. */
function derivedId({
  prefix,
  ruleRunId,
}: {
  prefix: "item" | "task";
  ruleRunId: string;
}): string {
  const suffix = ruleRunId.replace("rule_run_", "");
  const targetLength = idSuffixLengths[prefix];
  return `${prefix}_${suffix.slice(0, targetLength)}`;
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
      taskId: derivedId({ prefix: "task", ruleRunId: target.ruleRunId }),
      createdAt: Date.now(),
      taskTypeId: action.taskTypeId,
      sourceRuleId: target.ruleId,
      title: substitute(action.title) ?? "",
      description: substitute(action.description),
      assignedToTeamMemberId: action.assignToTeamMemberId,
    },
  });
}

/** add_invoice_item: append a charge to the tenant's open (unfinalized) invoice. */
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
  if (!open || open.finalizedAt !== null) {
    throw new Error(`no open invoice for tenant ${target.tenantId}`);
  }
  if (action.percentageOfInvoice !== null) {
    /* Percentage-of-invoice fees resolve against invoice totals at
     * execution, and invoice totals don't exist yet. Throw for every
     * percentage -- including mixed flat+percentage actions -- so a
     * configured fee is never silently undercharged. */
    throw new Error("percentage_of_invoice fees are not yet supported");
  }
  const valueId = action.fixedValueId;
  if (valueId === null) {
    throw new Error("add_invoice_item has no fixed value");
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
      itemId: derivedId({ prefix: "item", ruleRunId: target.ruleRunId }),
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

const EXECUTOR_INTERVAL_MS = 1_000;
/*
 * Drain ceiling: at most CLAIM_BATCH x EXECUTOR_DRAIN_BATCHES_PER_TICK runs
 * execute per EXECUTOR_INTERVAL_MS, per worker process -- each replica runs
 * its own loop and gets disjoint batches via the claim, so replicas
 * multiply the ceiling. The ceiling bounds write-behind only; rule firing
 * is uncapped upstream, so sustained excess just grows the due backlog. To
 * lift it, raise CLAIM_BATCH and/or EXECUTOR_DRAIN_BATCHES_PER_TICK; the
 * next constraint is pg-side (per-row action writes).
 */
const CLAIM_BATCH = 100;
const EXECUTOR_DRAIN_BATCHES_PER_TICK = 10;
/** Retry backoff (ms) by attempt; each gets full jitter. */
const RETRY_BACKOFF_MS = [1_000, 5_000, 30_000, 5 * 60_000];
/** Attempts after which a run is marked failed (no longer retried). */
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
/*
 * Claim lease: a row claimed longer ago than this is treated as abandoned
 * (its worker died mid-execution) and becomes reclaimable. Must exceed the
 * slowest realistic action plus retry scheduling; finalize clears it, so a
 * value that's merely generous is fine.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/**
 * Next eligible time with full jitter on the backoff, so a burst of failures
 * doesn't retry in lockstep (thundering herd).
 */
function nextAvailableAt({ attempts }: { attempts: number }): number {
  const backoff =
    RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)];
  return Date.now() + Math.floor(Math.random() * backoff);
}

/**
 * Claim one batch of due runs, atomically: SKIP LOCKED means concurrent
 * workers (multiple replicas, or an overlapping tick on the same process)
 * get disjoint rows, and the lease predicate reclaims rows whose worker
 * died mid-execution. Runs hold the claim outside any transaction, so the
 * lock is released the moment the claim returns.
 */
async function claimDueRuns(): Promise<(typeof ruleRuns.$inferSelect)[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ ruleRunId: ruleRuns.ruleRunId })
      .from(ruleRuns)
      .where(
        and(
          sql`${ruleRuns.succeededAt} is null`,
          sql`${ruleRuns.failedAt} is null`,
          sql`${ruleRuns.availableAt} <= ${Date.now()}`,
          sql`(${ruleRuns.claimedAt} is null or ${ruleRuns.claimedAt} < ${Date.now() - CLAIM_LEASE_MS})`,
        ),
      )
      .orderBy(ruleRuns.availableAt)
      .limit(CLAIM_BATCH)
      .for("update", { skipLocked: true });
    if (due.length === 0) {
      return [];
    }
    const ids = due.map((row) => row.ruleRunId);
    await tx
      .update(ruleRuns)
      .set({ claimedAt: Date.now() })
      .where(inArray(ruleRuns.ruleRunId, ids));
    return tx.select().from(ruleRuns).where(inArray(ruleRuns.ruleRunId, ids));
  });
}

/** Drain due rule_runs, executing each action. Returns the count handled. */
export async function executeDueRuleRuns(): Promise<number> {
  let handled = 0;
  for (let batch = 0; batch < EXECUTOR_DRAIN_BATCHES_PER_TICK; batch++) {
    const due = await claimDueRuns();
    if (due.length === 0) {
      break;
    }
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
          .set({ succeededAt: Date.now(), claimedAt: null, lastError: null })
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
            claimedAt: null,
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
    handled += due.length;
    if (due.length < CLAIM_BATCH) {
      break;
    }
  }
  return handled;
}

/**
 * Start the executor loop. Interval is unref'd and errors are logged, never
 * thrown -- a failed tick just defers execution to the next one. Overlapping
 * ticks on one process are safe: the claim gives each a disjoint batch.
 */
export function startRuleExecutorLoop(): void {
  const executor = setInterval(() => {
    executeDueRuleRuns().catch((error) =>
      console.error("rule executor tick failed", error),
    );
  }, EXECUTOR_INTERVAL_MS);
  executor.unref();
}
