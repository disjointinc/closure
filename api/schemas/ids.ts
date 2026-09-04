import { z } from "zod";

/**
 * Suffix length per id prefix. Suffixes are lowercase alphanumeric
 * ([a-z0-9], 36 symbols), so by the birthday paradox the collision
 * probability across n ids of a type is ~n^2 / (2 * 36^L). Lengths keep
 * that under 1 in a billion, assuming 1e8 users, 1e4 tenants per user
 * (1e12 tenants), and 1e12 meter events per tenant (1e24 events).
 */
export const idSuffixLengths = {
  // users of the pricing application: 1e8
  team_member: 16,
  // pricing schema entities: ~1e3 per user -> ~1e11 each
  add_on: 20,
  coupon: 20,
  coupon_template: 20,
  cycle: 20,
  experiment: 20,
  feature: 20,
  feature_option: 20,
  meter: 20,
  plan: 20,
  rule: 20,
  tax: 20,
  tax_type: 20,
  task_type: 20,
  value: 20,
  // tenants: 1e12
  tenant: 22,
  // tenant-scoped, ~1e1 per tenant -> ~1e13
  payment_method: 23,
  refund: 23,
  // tenant-scoped, ~1e2 per tenant -> ~1e14
  assignment: 24,
  feature_override: 24,
  loan: 24,
  meter_override: 24,
  // tenant-scoped, ~1e3 per tenant -> ~1e15
  credit_grant: 25,
  invoice: 25,
  payment: 25,
  task: 25,
  // ~1e4 per tenant (referrals) / ~1e1 per invoice -> ~1e16
  coupon_grant: 27,
  coupon_receipt: 27,
  item: 27,
  rule_run: 27,
  taxation_amount: 27,
  // meter events: 1e12 per tenant -> 1e24
  meter_event: 37,
} as const;

export type IdPrefix = keyof typeof idSuffixLengths;

/**
 * Every Closure entity id looks like "<prefix>_<suffix>", e.g.
 * "plan_abc123". The prefix is the entity's type, so each prefix gets
 * exactly one schema here. Anything in the domain with its own id prefix
 * gets its own schema file in this folder.
 *
 * Ids live in one shared module so entity schemas can reference each other's
 * ids freely without circular imports.
 */
function prefixedId(prefix: IdPrefix) {
  const length = idSuffixLengths[prefix];
  return z
    .string()
    .regex(
      new RegExp(`^${prefix}_[a-z0-9]{${length}}$`),
      `expected an id of the form ${prefix}_<${length} lowercase letters/digits>`,
    );
}

export const addOnIdSchema = prefixedId("add_on");
export const assignmentIdSchema = prefixedId("assignment");
export const couponIdSchema = prefixedId("coupon");
export const couponGrantIdSchema = prefixedId("coupon_grant");
export const couponReceiptIdSchema = prefixedId("coupon_receipt");
export const couponTemplateIdSchema = prefixedId("coupon_template");
export const creditGrantIdSchema = prefixedId("credit_grant");
export const cycleIdSchema = prefixedId("cycle");
export const experimentIdSchema = prefixedId("experiment");
export const featureIdSchema = prefixedId("feature");
export const featureOptionIdSchema = prefixedId("feature_option");
export const featureOverrideIdSchema = prefixedId("feature_override");
export const invoiceIdSchema = prefixedId("invoice");
export const itemIdSchema = prefixedId("item");
export const loanIdSchema = prefixedId("loan");
export const meterIdSchema = prefixedId("meter");
export const meterEventIdSchema = prefixedId("meter_event");
export const meterOverrideIdSchema = prefixedId("meter_override");
export const paymentIdSchema = prefixedId("payment");
export const paymentMethodIdSchema = prefixedId("payment_method");
export const planIdSchema = prefixedId("plan");
export const refundIdSchema = prefixedId("refund");
export const ruleIdSchema = prefixedId("rule");
export const ruleRunIdSchema = prefixedId("rule_run");
export const taxIdSchema = prefixedId("tax");
export const taxTypeIdSchema = prefixedId("tax_type");
export const taxationAmountIdSchema = prefixedId("taxation_amount");
export const teamMemberIdSchema = prefixedId("team_member");
export const tenantIdSchema = prefixedId("tenant");
export const taskIdSchema = prefixedId("task");
export const taskTypeIdSchema = prefixedId("task_type");
export const valueIdSchema = prefixedId("value");
