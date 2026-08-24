import { z } from "zod";

/**
 * Every Closure entity id looks like "<prefix>_<alphanumerics>",
 * e.g. "plan_abc123". The prefix is the entity's type, so each prefix gets
 * exactly one schema here. Anything in the domain with its own id prefix
 * gets its own schema file in this folder.
 *
 * Ids live in one shared module so entity schemas can reference each other's
 * ids freely without circular imports.
 */
function prefixedId(prefix: string) {
  return z
    .string()
    .regex(
      new RegExp(`^${prefix}_[A-Za-z0-9]+$`),
      `expected an id of the form ${prefix}_...`,
    );
}

export const addOnIdSchema = prefixedId("add_on");
export const assignmentIdSchema = prefixedId("assignment");
export const couponIdSchema = prefixedId("coupon");
export const couponGrantIdSchema = prefixedId("coupon_grant");
export const couponReceiptIdSchema = prefixedId("coupon_receipt");
export const creditGrantIdSchema = prefixedId("credit_grant");
export const cycleIdSchema = prefixedId("cycle");
export const experimentIdSchema = prefixedId("experiment");
export const featureIdSchema = prefixedId("feature");
export const featureOverrideIdSchema = prefixedId("feature_override");
export const invoiceIdSchema = prefixedId("invoice");
export const itemIdSchema = prefixedId("item");
export const meterIdSchema = prefixedId("meter");
export const meterEventIdSchema = prefixedId("meter_event");
export const meterOverrideIdSchema = prefixedId("meter_override");
export const optionIdSchema = prefixedId("option");
export const paymentIdSchema = prefixedId("payment");
export const paymentMethodIdSchema = prefixedId("payment_method");
export const planIdSchema = prefixedId("plan");
export const refundIdSchema = prefixedId("refund");
export const taxIdSchema = prefixedId("tax");
export const taxTypeIdSchema = prefixedId("tax_type");
export const taxationAmountIdSchema = prefixedId("taxation_amount");
export const teamMemberIdSchema = prefixedId("team_member");
export const tenantIdSchema = prefixedId("tenant");
export const valueIdSchema = prefixedId("value");
