/**
 * v0/rule/service.ts -- rule business logic. Rules are shared, first-class
 * definitions evaluated against metering and lifecycle events. The call
 * surface writes add_invoice_item flat fees as inline value create-inputs
 * and reads them back as full value objects; the canonical rule stored in
 * the db keeps value ids (the same resolve/expand pattern items use for
 * per-unit values).
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { rules, values } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import { taskTypeIdSchema, teamMemberIdSchema } from "../../schemas/ids.ts";
import {
  checkRule,
  type Rule,
  type RuleAction,
  ruleSchema,
} from "../../schemas/rule.ts";
import { type Value, valueCreateSchema } from "../../schemas/value.ts";

/** Call-surface rule actions: add_invoice_item carries an inline value create-input. */
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
      fixedValue: valueCreateSchema.nullable(),
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

/**
 * The create-input rule: the server mints ruleId and stamps times. checkRule
 * only reads fields identical across the canonical and call-surface action
 * shapes (its signature admits nothing else), so actions pass straight
 * through with no mapping.
 */
export const ruleApiSchema = z
  .object(ruleSchema.shape)
  .omit({ ruleId: true, createdAt: true, deprecatedAt: true })
  .extend({ actions: z.array(ruleActionApiSchema).min(1) })
  .superRefine((rule, ctx) => checkRule(rule, ctx));
export type RuleCreateBody = z.infer<typeof ruleApiSchema>;

/** The rule shape the call surface reads. */
export type RuleApi = Omit<Rule, "actions"> & { actions: RuleActionApi[] };

/** Mint and store a call-surface action's value, returning the canonical action. */
async function resolveAction(action: RuleActionApi): Promise<RuleAction> {
  if (action.type !== "add_invoice_item") {
    return action;
  }
  let fixedValueId: string | null = null;
  if (action.fixedValue !== null) {
    fixedValueId = generateId({ prefix: "value" });
    await db
      .insert(values)
      .values({
        ...action.fixedValue,
        valueId: fixedValueId,
        createdAt: Date.now(),
        deprecatedAt: null,
      })
      .onConflictDoNothing();
  }
  return {
    type: "add_invoice_item",
    fixedValueId,
    percentageOfInvoice: action.percentageOfInvoice,
  };
}

/** Mint the rule id and store action values, returning the canonical rule. */
async function resolveRule(rule: RuleCreateBody): Promise<Rule> {
  const actions: RuleAction[] = [];
  for (const action of rule.actions) {
    actions.push(await resolveAction(action));
  }
  return {
    ...rule,
    ruleId: generateId({ prefix: "rule" }),
    createdAt: Date.now(),
    deprecatedAt: null,
    actions,
  };
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

/** Create a rule, minting its id and storing add_invoice_item fee values as ids. */
export async function createRule({
  rule,
}: {
  rule: RuleCreateBody;
}): Promise<RuleApi | null> {
  const stored = await resolveRule(rule);
  await db.insert(rules).values(stored).onConflictDoNothing();
  return getRule({ ruleId: stored.ruleId });
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
