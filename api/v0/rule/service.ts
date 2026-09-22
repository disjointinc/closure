/**
 * v0/rule/service.ts -- rule business logic. Rules are shared, first-class
 * definitions evaluated against metering and lifecycle events. The call
 * surface passes add_invoice_item flat fees as inline amounts; the stored
 * rule keeps the same shape.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { meters, plans, rules } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Rule } from "../../schemas/rule.ts";
import { areLinesSynchronized } from "../product-line/service.ts";
import type { RuleCreateBody } from "./routes.ts";

export async function listRules(): Promise<Rule[]> {
  return db.select().from(rules);
}

export async function getRule({
  ruleId,
}: {
  ruleId: string;
}): Promise<Rule | null> {
  const [row] = await db.select().from(rules).where(eq(rules.ruleId, ruleId));
  return row ?? null;
}

/**
 * Why a rule can't be created, when it can't. Cycle-derived triggers need a
 * single billing-cycle anchor:
 *
 *   - Meter triggers whose evaluation derives from billing_cycle_end
 *     (a cycle-aligned recurrence window, or a microcredits_spent trigger,
 *     whose spend window is the current cycle) anchor to the meter's lines.
 *     A meter spanning several lines anchors only when all those lines are
 *     billing-cycle-synchronized.
 *   - Lifecycle triggers anchor to their plan scope's line, so a
 *     cycle-aligned window requires a plan scope in a single line.
 */
async function ruleCreateError({
  rule,
}: {
  rule: RuleCreateBody;
}): Promise<string | null> {
  const trigger = rule.trigger;
  if (
    trigger.type === "microcredits_remaining" ||
    trigger.type === "microcredits_spent" ||
    trigger.type === "inactive_for"
  ) {
    const needsSync =
      trigger.type === "microcredits_spent" ||
      rule.recurrence.window === "billing_cycle_end";
    if (!needsSync) {
      return null;
    }
    const [meter] = await db
      .select()
      .from(meters)
      .where(eq(meters.meterId, trigger.meterId))
      .limit(1);
    if (!meter) {
      return `meter ${trigger.meterId} not found`;
    }
    if (
      !(await areLinesSynchronized({ productLineIds: meter.productLineIds }))
    ) {
      return (
        `a meter can only trigger tasks on billing cycle end if all the ` +
        `product lines using that meter have synchronized billing cycles; ` +
        `meter ${meter.meterId} applies to ${meter.productLineIds.join(", ")}, ` +
        `which are not all synchronized`
      );
    }
    return null;
  }
  if (rule.recurrence.window !== "billing_cycle_end") {
    return null;
  }
  if (rule.scope.kind !== "plan") {
    return (
      "a billing_cycle_end window on a lifecycle rule needs a plan scope " +
      "whose plans share one product line"
    );
  }
  const planRows = await db
    .select()
    .from(plans)
    .where(inArray(plans.planId, rule.scope.planIds));
  const lines = new Set(planRows.map((plan) => plan.productLineId));
  if (lines.size !== 1) {
    return (
      "a billing_cycle_end window on a lifecycle rule needs a plan scope " +
      "whose plans share one product line"
    );
  }
  return null;
}

/** Create a rule, minting its id and stamping times. */
export async function createRule({
  rule,
}: {
  rule: RuleCreateBody;
}): Promise<Rule | { error: string }> {
  const error = await ruleCreateError({ rule });
  if (error !== null) {
    return { error };
  }
  const stored: Rule = {
    ...rule,
    ruleId: generateId({ prefix: "rule" }),
    createdAt: Date.now(),
    deprecatedAt: null,
  };
  await db.insert(rules).values(stored).onConflictDoNothing();
  return stored;
}

/** Deprecate the rule, or return null if no such rule exists. */
export async function deprecateRule({
  ruleId,
}: {
  ruleId: string;
}): Promise<Rule | null> {
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
