/**
 * v0/rule/service.ts -- rule business logic. Rules are shared, first-class
 * definitions evaluated against metering and lifecycle events. The call
 * surface passes add_invoice_item flat fees as full value objects; the
 * canonical rule stored in the db keeps value ids (the same resolve/expand
 * pattern items use for per-unit values).
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { rules, values } from "../../db/schema.ts";
import { taskTypeIdSchema, teamMemberIdSchema } from "../../schemas/ids.ts";
import { type Rule, type RuleAction, ruleSchema } from "../../schemas/rule.ts";
import { valueSchema, type Value } from "../../schemas/value.ts";

/** Call-surface rule actions: add_invoice_item carries the full value. */
const ruleActionApiSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    taskTypeId: taskTypeIdSchema,
    title: z.string().min(1),
    description: z.string().nullable(),
    assignToTeamMemberId: teamMemberIdSchema.nullable(),
  }),
  z
    .object({
      type: z.literal("add_invoice_item"),
      fixedValue: valueSchema.nullable(),
      percentageOfInvoice: z.number().positive().nullable(),
    })
    .refine(
      (action) =>
        action.fixedValue !== null || action.percentageOfInvoice !== null,
      {
        message: "add_invoice_item requires a flat fee and/or a percentage",
      },
    ),
  z.object({
    type: z.literal("retry_payment"),
    notes: z.string(),
  }),
]);
export type RuleActionApi = z.infer<typeof ruleActionApiSchema>;

/** The rule shape the call surface reads and writes. */
export const ruleApiSchema = ruleSchema.extend({
  actions: z.array(ruleActionApiSchema).min(1),
});
export type RuleApi = z.infer<typeof ruleApiSchema>;

/** Store a call-surface action's values, returning the canonical action. */
async function resolveAction(action: RuleActionApi): Promise<RuleAction> {
  if (action.type !== "add_invoice_item") {
    return action;
  }
  if (action.fixedValue !== null) {
    await db.insert(values).values(action.fixedValue).onConflictDoNothing();
  }
  return {
    type: "add_invoice_item",
    fixedValueId: action.fixedValue === null ? null : action.fixedValue.valueId,
    percentageOfInvoice: action.percentageOfInvoice,
  };
}

/** Store a call-surface rule's action values, returning the canonical rule. */
async function resolveRule(rule: RuleApi): Promise<Rule> {
  const actions: RuleAction[] = [];
  for (const action of rule.actions) {
    actions.push(await resolveAction(action));
  }
  return { ...rule, actions };
}

/** Expand a stored rule's add_invoice_item value ids into full values. */
async function expandRule(rule: Rule): Promise<RuleApi> {
  const feeValueIds = rule.actions
    .filter(
      (action): action is Extract<RuleAction, { type: "add_invoice_item" }> =>
        action.type === "add_invoice_item",
    )
    .map((action) => action.fixedValueId)
    .filter((valueId): valueId is string => valueId !== null);
  const valueRows = feeValueIds.length
    ? await db.select().from(values).where(inArray(values.valueId, feeValueIds))
    : [];
  const valueById = new Map(valueRows.map((value) => [value.valueId, value]));
  return {
    ...rule,
    actions: rule.actions.map((action) => {
      if (action.type !== "add_invoice_item") {
        return action;
      }
      // A fee value row always exists once its id is stored.
      const fixedValue =
        action.fixedValueId === null
          ? null
          : (valueById.get(action.fixedValueId) as Value);
      return {
        type: "add_invoice_item" as const,
        fixedValue,
        percentageOfInvoice: action.percentageOfInvoice,
      };
    }),
  };
}

export async function listRules(): Promise<RuleApi[]> {
  const rows = await db.select().from(rules);
  return Promise.all(rows.map(expandRule));
}

export async function getRule({
  ruleId,
}: {
  ruleId: string;
}): Promise<RuleApi | null> {
  const [row] = await db.select().from(rules).where(eq(rules.ruleId, ruleId));
  if (!row) {
    return null;
  }
  return expandRule(row);
}

/** Create a rule, storing add_invoice_item fee values as ids. */
export async function createRule({
  rule,
}: {
  rule: RuleApi;
}): Promise<RuleApi | null> {
  const stored = await resolveRule(rule);
  await db.insert(rules).values(stored).onConflictDoNothing();
  return getRule({ ruleId: rule.ruleId });
}

/** Deprecate the rule, or return null if no such rule exists. */
export async function deprecateRule({
  ruleId,
}: {
  ruleId: string;
}): Promise<RuleApi | null> {
  const updated = await db
    .update(rules)
    .set({ deprecatedAt: Date.now() })
    .where(eq(rules.ruleId, ruleId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getRule({ ruleId });
}
