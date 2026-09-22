import { z } from "zod";
import {
  amountsSchema,
  durationSchema,
  epochMs,
  microcredits,
  resetSchedule,
} from "./common.ts";
import {
  invoiceIdSchema,
  meterIdSchema,
  planIdSchema,
  ruleIdSchema,
  taskTypeIdSchema,
  teamMemberIdSchema,
  tenantIdSchema,
} from "./ids.ts";

/**
 * A metering- or lifecycle-triggered action item. Rules generalize dunning:
 * a trigger condition plus a set of actions, evaluated either at meter-event
 * time (microcredits_remaining, microcredits_spent) or by a periodic
 * scheduler (inactive_for, relative_to_lifecycle_event). Scopes are additive.
 */

/** An absolute amount, or a percentage of the tenant's initial allocation. */
const amountOrPercentageSchema = z.union([
  z.object({ absolute: microcredits.nonnegative() }),
  z.object({ percentageOfInitialAllocation: z.number().positive().max(100) }),
]);

/** Fires when the balance remaining crosses (at or below) a value. */
const microcreditsRemainingTriggerSchema = z.object({
  type: z.literal("microcredits_remaining"),
  meterId: meterIdSchema,
  at: amountOrPercentageSchema,
});

/**
 * Fires when cumulative spend crosses (at or above) a value. More general
 * than a first-use signal: first use is { at: { absolute: 1 } }.
 */
const microcreditsSpentTriggerSchema = z.object({
  type: z.literal("microcredits_spent"),
  meterId: meterIdSchema,
  at: amountOrPercentageSchema,
});

/** Fires when a tenant records no events on a meter for a duration. */
const inactiveForTriggerSchema = z.object({
  type: z.literal("inactive_for"),
  meterId: meterIdSchema,
  duration: durationSchema,
});

/**
 * Fires relative to a lifecycle event; offset is added to the event time
 * (negative offsets fire before). Subsumes dunning, e.g.
 * { relativeTo: "invoice_due", offset: { days: 3 } }.
 */
const relativeToLifecycleEventTriggerSchema = z.object({
  type: z.literal("relative_to_lifecycle_event"),
  relativeTo: z.enum([
    "invoice_finalized",
    "invoice_due",
    "cycle_end",
    "assignment_started",
  ]),
  offset: durationSchema,
});

export const ruleTriggerSchema = z.discriminatedUnion("type", [
  microcreditsRemainingTriggerSchema,
  microcreditsSpentTriggerSchema,
  inactiveForTriggerSchema,
  relativeToLifecycleEventTriggerSchema,
]);
export type RuleTrigger = z.infer<typeof ruleTriggerSchema>;

/**
 * The facts a trigger observed when it fired, captured on the rule_run and
 * substituted into create_task title/description placeholders. Keyed by
 * trigger type; each variant carries only what that trigger knows. tenantId
 * is always available from the run row, so it isn't repeated here. Numbers
 * stay numbers (microcredits) until substitution into text at execution.
 */
export const firingPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("microcredits_remaining"),
    meterId: meterIdSchema,
    balanceMicrocredits: microcredits,
    thresholdMicrocredits: microcredits,
  }),
  z.object({
    type: z.literal("microcredits_spent"),
    meterId: meterIdSchema,
    spentMicrocredits: microcredits,
    thresholdMicrocredits: microcredits,
  }),
  z.object({ type: z.literal("inactive_for"), meterId: meterIdSchema }),
  z.object({
    type: z.literal("relative_to_lifecycle_event"),
    invoiceId: invoiceIdSchema,
  }),
]);
export type FiringPayload = z.infer<typeof firingPayloadSchema>;

/**
 * The {{placeholder}} names a create_task template may use, per trigger
 * type: tenantId (always, from the run) plus the payload's own fields.
 * Used to validate templates at rule-write time.
 */
export const PLACEHOLDERS_BY_TRIGGER: Record<
  RuleTrigger["type"],
  readonly string[]
> = {
  microcredits_remaining: [
    "tenantId",
    "meterId",
    "balanceMicrocredits",
    "thresholdMicrocredits",
  ],
  microcredits_spent: [
    "tenantId",
    "meterId",
    "spentMicrocredits",
    "thresholdMicrocredits",
  ],
  inactive_for: ["tenantId", "meterId"],
  relative_to_lifecycle_event: ["tenantId", "invoiceId"],
};

/** Create an internal task (routes to the type's external integrations). */
const createTaskActionSchema = z.object({
  type: z.literal("create_task"),
  taskTypeId: taskTypeIdSchema,
  /** Placeholders are validated against PLACEHOLDERS_BY_TRIGGER at write time. */
  title: z.string().min(1),
  description: z.string().nullable(),
  assignToTeamMemberId: teamMemberIdSchema.nullable(),
});

/**
 * Add a charge to the tenant's open invoice (late fees, overage fees). A
 * flat amount and/or a percentage of the invoice; at least one must be set.
 */
const addInvoiceItemActionSchema = z
  .object({
    type: z.literal("add_invoice_item"),
    fixedAmounts: amountsSchema.nullable(),
    percentageOfInvoice: z.number().positive().nullable(),
  })
  .refine(
    (action) =>
      action.fixedAmounts !== null || action.percentageOfInvoice !== null,
    {
      message: "add_invoice_item requires a flat fee and/or a percentage",
    },
  );

/** Retry the tenant's payment (dunning). */
const retryPaymentActionSchema = z.object({
  type: z.literal("retry_payment"),
  notes: z.string(),
});

export const ruleActionSchema = z.discriminatedUnion("type", [
  createTaskActionSchema,
  addInvoiceItemActionSchema,
  retryPaymentActionSchema,
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

/**
 * How often a rule may fire for a given target, to bound notification spam.
 * Two orthogonal knobs:
 *
 *   - window: what time boundary opens a new firing window. null = one
 *     permanent window (fire once, ever, per trigger instance); a Duration =
 *     a rolling window of that length; "billing_cycle_end" = aligned to the
 *     tenant's billing cycle.
 *   - rearmOnRecover: only meaningful for the metering triggers
 *     (microcredits_remaining / microcredits_spent). When true, the condition
 *     going false (e.g. a top-up lifts the balance back over the threshold)
 *     re-arms the edge detector, so the next crossing fires fresh even within
 *     the current window.
 *
 * limitRecurrences caps firings per window (null = unlimited); recovery
 * re-arms the edge but never bypasses the quota.
 */
export const ruleRecurrenceSchema = z.object({
  window: resetSchedule.nullable(),
  rearmOnRecover: z.boolean(),
  limitRecurrences: z.number().int().positive().nullable(),
});
export type RuleRecurrence = z.infer<typeof ruleRecurrenceSchema>;

/** Extract the {{placeholder}} names from a template string. */
function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
}

/**
 * RuleAction without the server-minted amount, so the create schema can
 * validate before the id exists. Derived by omission so new fields and
 * variants on RuleAction flow through automatically.
 */
type RuleCheckAction =
  | Omit<Extract<RuleAction, { type: "add_invoice_item" }>, "fixedValueId">
  | Exclude<RuleAction, { type: "add_invoice_item" }>;

/**
 * Cross-field rule check: every {{placeholder}} in a create_task template
 * must be one the rule's trigger supplies (PLACEHOLDERS_BY_TRIGGER), so a
 * template can't reference a value its trigger never captures. And
 * rearmOnRecover is only meaningful on the metering triggers -- lifecycle
 * triggers (relative_to_lifecycle_event, inactive_for) have no "recovery"
 * edge to re-arm on.
 */
export function checkRule(
  rule: {
    trigger: RuleTrigger;
    recurrence: RuleRecurrence;
    actions: RuleCheckAction[];
  },
  ctx: z.RefinementCtx,
): void {
  const isMetering =
    rule.trigger.type === "microcredits_remaining" ||
    rule.trigger.type === "microcredits_spent";
  if (rule.recurrence.rearmOnRecover && !isMetering) {
    ctx.addIssue({
      code: "custom",
      path: ["recurrence", "rearmOnRecover"],
      message:
        "rearmOnRecover is only meaningful for microcredits_remaining / microcredits_spent rules",
    });
  }
  const available = new Set(PLACEHOLDERS_BY_TRIGGER[rule.trigger.type]);
  rule.actions.forEach((action, actionIndex) => {
    if (action.type !== "create_task") {
      return;
    }
    for (const [field, template] of [
      ["title", action.title],
      ["description", action.description],
    ] as const) {
      if (template === null) {
        continue;
      }
      for (const placeholder of templatePlaceholders(template)) {
        if (!available.has(placeholder)) {
          ctx.addIssue({
            code: "custom",
            path: ["actions", actionIndex, field],
            message: `{{${placeholder}}} is not available for a ${rule.trigger.type} rule (available: ${[...available].join(", ")})`,
          });
        }
      }
    }
  });
}

export const ruleSchema = z
  .object({
    ruleId: ruleIdSchema,
    createdAt: epochMs,
    deprecatedAt: epochMs.nullable(),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("global") }),
      z.object({
        kind: z.literal("plan"),
        planIds: z.array(planIdSchema).min(1),
      }),
      z.object({ kind: z.literal("tenant"), tenantId: tenantIdSchema }),
    ]),
    trigger: ruleTriggerSchema,
    recurrence: ruleRecurrenceSchema,
    actions: z.array(ruleActionSchema).min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
  })
  .superRefine(checkRule);
export type Rule = z.infer<typeof ruleSchema>;
