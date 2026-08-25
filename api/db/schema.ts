/**
 * schema.ts -- Closure's Postgres schema (Drizzle).
 *
 * Translated from the zod schemas in api/schemas/ (the source of truth for
 * the API boundary):
 *
 * - Every entity with its own id prefix is a table with a text prefixed-id
 *   primary key, plus a check constraint enforcing the id's format.
 * - Cross-entity references are real foreign keys, so resources must be
 *   created in dependency order (cycles/values before prices, plans before
 *   assignments, tenants before invoices, ...).
 * - Self-contained value objects (durations, awards, currency amounts,
 *   provider internals, top-up configs, ...) are jsonb columns typed with
 *   the zod-inferred types.
 * - Zod refinements that map cleanly to SQL (limit >= default, charging
 *   variants, coupon grantor variants, positive amounts) are check
 *   constraints.
 */
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { CurrencyAmount, Duration } from "../schemas/common.ts";
import type { Award } from "../schemas/coupon.ts";
import type { DunningAction } from "../schemas/cycle.ts";
import { idSuffixLengths, type IdPrefix } from "../schemas/ids.ts";
import type { Payment } from "../schemas/payment.ts";
import type { PaymentMethod } from "../schemas/payment_method.ts";
import type { PlanMeter } from "../schemas/plan.ts";

/** Check constraint enforcing "<prefix>_<suffix of [a-z0-9]>" id format. */
function idFormatCheck(prefix: IdPrefix, columns: { uniqueId: SQLWrapper }) {
  // Inlined as a literal: check constraints can't take parameters.
  const pattern = `'^${prefix}_[a-z0-9]{${idSuffixLengths[prefix]}}$'`;
  return check(
    `${prefix}_id_format`,
    sql`${columns.uniqueId} ~ ${sql.raw(pattern)}`,
  );
}

/** Milliseconds since the unix epoch, as stored in the db. */
const epochMs = (name: string) => bigint(name, { mode: "number" });

/** Integer microcredits, as stored in the db. */
const microcredits = (name: string) => bigint(name, { mode: "number" });

/** A length of time: durationSchema, or a literal like "one-time". */
const duration = (name: string) => jsonb(name).$type<Duration>();

/** When credits expire or allocations reset. Null means "never". */
const resetSchedule = (name: string) =>
  jsonb(name).$type<Duration | "billing_cycle_end">();

/** What a feature is set to: boolean, or the list of enabled options. */
const featureSetTo = (name: string) => jsonb(name).$type<boolean | string[]>();

/** A price per usage tier (plan meter top-ups). */
const topUpPricesPerCredit = (name: string) =>
  jsonb(name).$type<PlanMeter["top_up_prices_per_credit"]>();

const topUpCreditPackSizes = (name: string) =>
  jsonb(name).$type<PlanMeter["top_up_credit_pack_sizes"]>();

export const chargedEnum = pgEnum("charged", ["upfront", "arrears"]);
export const meterEventStatusEnum = pgEnum("meter_event_status", [
  "succeeded",
  "insufficient_balance",
  "unexpected_error",
]);
export const grantorTypeEnum = pgEnum("grantor_type", [
  "team_member",
  "tenant",
  "reciprocal",
]);

/**
 * The charging columns shared by cycles and invoices, mirroring the
 * charging discriminated union. See chargingCheck below.
 */
const chargingColumns = {
  charged: chargedEnum("charged").notNull(),
  /** Duration, or "one-time" (upfront only). */
  cycleLength: jsonb("cycle_length").$type<Duration | "one-time">().notNull(),
  creditPeriod: duration("credit_period"),
  gracePeriod: duration("grace_period"),
  dunningSchedule:
    jsonb("dunning_schedule").$type<
      { after: Duration; actions: DunningAction[] }[]
    >(),
};

/** Upfront rows carry no arrears-only fields; arrears rows require them. */
function chargingCheck(table: string) {
  return check(
    `${table}_charging_variant`,
    sql`(charged = 'upfront' and credit_period is null and grace_period is null and dunning_schedule is null)
     or (charged = 'arrears' and credit_period is not null)`,
  );
}

// ---------------------------------------------------------------------------
// Users of the pricing application
// ---------------------------------------------------------------------------

export const teamMembers = pgTable(
  "team_members",
  {
    uniqueId: text("unique_id").primaryKey(),
    emailAddress: text("email_address").notNull().unique(),
    name: text("name"),
    profilePictureLink: text("profile_picture_link"),
  },
  (t) => [idFormatCheck("team_member", t)],
);

// ---------------------------------------------------------------------------
// Core pricing entities (immutable / versioned)
// ---------------------------------------------------------------------------

export const values = pgTable(
  "values",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
    amounts: jsonb("amounts").$type<CurrencyAmount[]>().notNull(),
  },
  (t) => [idFormatCheck("value", t)],
);

export const cycles = pgTable(
  "cycles",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
    ...chargingColumns,
  },
  (t) => [idFormatCheck("cycle", t), chargingCheck("cycles")],
);

export const taxTypes = pgTable(
  "tax_types",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("tax_type", t)],
);

export const taxes = pgTable(
  "taxes",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    taxType: text("tax_type")
      .notNull()
      .references(() => taxTypes.uniqueId),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("tax", t)],
);

export const features = pgTable(
  "features",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("feature", t)],
);

export const featureOptions = pgTable(
  "feature_options",
  {
    uniqueId: text("unique_id").primaryKey(),
    feature: text("feature")
      .notNull()
      .references(() => features.uniqueId),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("feature_option", t)],
);

/** feature.applicable_tax_types, relational so the FK is enforced. */
export const featureTaxTypes = pgTable(
  "feature_tax_types",
  {
    feature: text("feature")
      .notNull()
      .references(() => features.uniqueId),
    taxType: text("tax_type")
      .notNull()
      .references(() => taxTypes.uniqueId),
  },
  (t) => [primaryKey({ columns: [t.feature, t.taxType] })],
);

export const meters = pgTable(
  "meters",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("meter", t)],
);

/** meter.applicable_tax_types, relational so the FK is enforced. */
export const meterTaxTypes = pgTable(
  "meter_tax_types",
  {
    meter: text("meter")
      .notNull()
      .references(() => meters.uniqueId),
    taxType: text("tax_type")
      .notNull()
      .references(() => taxTypes.uniqueId),
  },
  (t) => [primaryKey({ columns: [t.meter, t.taxType] })],
);

export const plans = pgTable(
  "plans",
  {
    uniqueId: text("unique_id").primaryKey(),
    /** The plan this version was derived from, if any. */
    derivedFrom: text("derived_from").references(
      (): AnyPgColumn => plans.uniqueId,
    ),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("plan", t)],
);

export const planPrices = pgTable(
  "plan_prices",
  {
    plan: text("plan")
      .notNull()
      .references(() => plans.uniqueId),
    cycle: text("cycle")
      .notNull()
      .references(() => cycles.uniqueId),
    value: text("value")
      .notNull()
      .references(() => values.uniqueId),
  },
  (t) => [primaryKey({ columns: [t.plan, t.cycle] })],
);

export const planFeatures = pgTable(
  "plan_features",
  {
    plan: text("plan")
      .notNull()
      .references(() => plans.uniqueId),
    feature: text("feature")
      .notNull()
      .references(() => features.uniqueId),
    setTo: featureSetTo("set_to").notNull(),
  },
  (t) => [primaryKey({ columns: [t.plan, t.feature] })],
);

/** The meter-entry columns shared by plan_meters and meter_overrides. */
const planMeterColumns = {
  defaultMicrocredits: microcredits("default_microcredits").notNull(),
  limitMicrocredits: microcredits("limit_microcredits"),
  reset: resetSchedule("reset"),
  rollovers: integer("rollovers"),
  topUpPricesPerCredit: topUpPricesPerCredit("top_up_prices_per_credit"),
  topUpCreditPackSizes: topUpCreditPackSizes("top_up_credit_pack_sizes"),
};

/** plan_meter limit must be >= default (from checkPlanMeter). */
const limitGteDefaultCheck = (table: string) =>
  check(
    `${table}_limit_gte_default`,
    sql`limit_microcredits is null or limit_microcredits >= default_microcredits`,
  );

export const planMeters = pgTable(
  "plan_meters",
  {
    plan: text("plan")
      .notNull()
      .references(() => plans.uniqueId),
    meter: text("meter")
      .notNull()
      .references(() => meters.uniqueId),
    ...planMeterColumns,
  },
  (t) => [
    primaryKey({ columns: [t.plan, t.meter] }),
    limitGteDefaultCheck("plan_meters"),
    check("plan_meters_default_nonnegative", sql`default_microcredits >= 0`),
    check("plan_meters_limit_positive", sql`limit_microcredits > 0`),
  ],
);

export const planAddOns = pgTable(
  "plan_add_ons",
  {
    plan: text("plan")
      .notNull()
      .references(() => plans.uniqueId),
    addOn: text("add_on")
      .notNull()
      .references(() => addOns.uniqueId),
  },
  (t) => [primaryKey({ columns: [t.plan, t.addOn] })],
);

export const addOns = pgTable(
  "add_ons",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("add_on", t)],
);

export const addOnPrices = pgTable(
  "add_on_prices",
  {
    addOn: text("add_on")
      .notNull()
      .references(() => addOns.uniqueId),
    cycle: text("cycle")
      .notNull()
      .references(() => cycles.uniqueId),
    value: text("value")
      .notNull()
      .references(() => values.uniqueId),
  },
  (t) => [primaryKey({ columns: [t.addOn, t.cycle] })],
);

export const addOnFeatures = pgTable(
  "add_on_features",
  {
    addOn: text("add_on")
      .notNull()
      .references(() => addOns.uniqueId),
    feature: text("feature")
      .notNull()
      .references(() => features.uniqueId),
    setTo: featureSetTo("set_to").notNull(),
  },
  (t) => [primaryKey({ columns: [t.addOn, t.feature] })],
);

export const coupons = pgTable(
  "coupons",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    grantableByTenants: boolean("grantable_by_tenants").notNull(),
    /** Only settable when grantable_by_tenants. Null means no limit. */
    limitPerGrantingTenant: integer("limit_per_granting_tenant"),
    name: text("name").notNull(),
    description: text("description"),
    defaultAward: jsonb("default_award").$type<Award>(),
    /** Only settable when grantable_by_tenants. */
    reciprocalBenefitCoupon: text("reciprocal_benefit_coupon").references(
      (): AnyPgColumn => coupons.uniqueId,
    ),
  },
  (t) => [
    idFormatCheck("coupon", t),
    check(
      "coupons_grantable_gating",
      sql`grantable_by_tenants or (limit_per_granting_tenant is null and reciprocal_benefit_coupon is null)`,
    ),
  ],
);

export const couponFeaturesGranted = pgTable(
  "coupon_features_granted",
  {
    coupon: text("coupon")
      .notNull()
      .references(() => coupons.uniqueId),
    feature: text("feature")
      .notNull()
      .references(() => features.uniqueId),
    value: featureSetTo("value").notNull(),
    award: jsonb("award").$type<Award>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.coupon, t.feature] })],
);

export const couponCreditsGranted = pgTable(
  "coupon_credits_granted",
  {
    coupon: text("coupon")
      .notNull()
      .references(() => coupons.uniqueId),
    meter: text("meter")
      .notNull()
      .references(() => meters.uniqueId),
    amountMicrocredits: microcredits("amount_microcredits").notNull(),
    /** Null means the credits never expire. */
    expiration: resetSchedule("expiration"),
    /** Null means unlimited rollovers. */
    rollovers: integer("rollovers"),
    award: jsonb("award").$type<Award>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.coupon, t.meter] }),
    check("coupon_credits_amount_positive", sql`amount_microcredits > 0`),
  ],
);

export const experiments = pgTable(
  "experiments",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    concludedAt: epochMs("concluded_at"),
    planAssignmentAtConclusion: text(
      "plan_assignment_at_conclusion",
    ).references(() => plans.uniqueId),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("experiment", t)],
);

export const experimentTreatments = pgTable(
  "experiment_treatments",
  {
    experiment: text("experiment")
      .notNull()
      .references(() => experiments.uniqueId),
    plan: text("plan")
      .notNull()
      .references(() => plans.uniqueId),
    tenantPercentage: doublePrecision("tenant_percentage").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.experiment, t.plan] }),
    check(
      "experiment_treatments_percentage_range",
      sql`tenant_percentage >= 0 and tenant_percentage <= 100`,
    ),
  ],
);

/**
 * Treatment-level tenant assignments (treatment.assigned_tenants), relational
 * so the FK is enforced and "which treatment is this tenant in" stays fast.
 */
export const experimentTreatmentTenants = pgTable(
  "experiment_treatment_tenants",
  {
    experiment: text("experiment").notNull(),
    plan: text("plan").notNull(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
  },
  (t) => [
    primaryKey({ columns: [t.experiment, t.tenant] }),
    foreignKey({
      columns: [t.experiment, t.plan],
      foreignColumns: [
        experimentTreatments.experiment,
        experimentTreatments.plan,
      ],
    }),
    index("experiment_treatment_tenants_tenant").on(t.tenant),
  ],
);

// ---------------------------------------------------------------------------
// Tenants and everything scoped to one
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  "tenants",
  {
    uniqueId: text("unique_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deletedAt: epochMs("deleted_at"),
    externalIds: jsonb("external_ids")
      .$type<Record<string, string>>()
      .notNull(),
  },
  (t) => [idFormatCheck("tenant", t)],
);

export const assignments = pgTable(
  "assignments",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    plan: text("plan")
      .notNull()
      .references(() => plans.uniqueId),
    /** Set when the assignment came from an experiment treatment. */
    experiment: text("experiment").references(() => experiments.uniqueId),
    cycle: text("cycle")
      .notNull()
      .references(() => cycles.uniqueId),
    start: epochMs("start").notNull(),
    end: epochMs("end"),
  },
  (t) => [
    idFormatCheck("assignment", t),
    index("assignments_tenant").on(t.tenant),
  ],
);

export const assignmentAddOns = pgTable(
  "assignment_add_ons",
  {
    assignment: text("assignment")
      .notNull()
      .references(() => assignments.uniqueId),
    addOn: text("add_on")
      .notNull()
      .references(() => addOns.uniqueId),
    start: epochMs("start").notNull(),
    end: epochMs("end"),
  },
  (t) => [primaryKey({ columns: [t.assignment, t.addOn, t.start] })],
);

export const invoices = pgTable(
  "invoices",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    createdAt: epochMs("created_at").notNull(),
    closedAt: epochMs("closed_at"),
    closedReason: text("closed_reason"),
    ...chargingColumns,
  },
  (t) => [
    idFormatCheck("invoice", t),
    chargingCheck("invoices"),
    index("invoices_tenant").on(t.tenant),
  ],
);

export const items = pgTable(
  "items",
  {
    uniqueId: text("unique_id").primaryKey(),
    invoice: text("invoice")
      .notNull()
      .references(() => invoices.uniqueId),
    perUnitValue: text("per_unit_value")
      .notNull()
      .references(() => values.uniqueId),
    units: doublePrecision("units").notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [
    idFormatCheck("item", t),
    check("items_units_nonnegative", sql`units >= 0`),
  ],
);

export const taxationAmounts = pgTable(
  "taxation_amounts",
  {
    uniqueId: text("unique_id").primaryKey(),
    invoice: text("invoice")
      .notNull()
      .references(() => invoices.uniqueId),
    tax: text("tax")
      .notNull()
      .references(() => taxes.uniqueId),
    notes: text("notes"),
    amount: jsonb("amount").$type<CurrencyAmount>().notNull(),
  },
  (t) => [idFormatCheck("taxation_amount", t)],
);

/** taxation_amount.applies_to_items, relational so the FK is enforced. */
export const taxationAmountItems = pgTable(
  "taxation_amount_items",
  {
    taxationAmount: text("taxation_amount")
      .notNull()
      .references(() => taxationAmounts.uniqueId),
    item: text("item")
      .notNull()
      .references(() => items.uniqueId),
  },
  (t) => [primaryKey({ columns: [t.taxationAmount, t.item] })],
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    createdAt: epochMs("created_at").notNull(),
    deletedAt: epochMs("deleted_at"),
    isDefault: boolean("is_default").notNull(),
    /** Provider references only -- no payment details on our servers. */
    providerInternals: jsonb("provider_internals")
      .$type<PaymentMethod["provider_internals"]>()
      .notNull(),
  },
  (t) => [
    idFormatCheck("payment_method", t),
    // At most one active default payment method per tenant.
    uniqueIndex("payment_methods_one_default")
      .on(t.tenant)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    createdAt: epochMs("created_at").notNull(),
    startedProcessingAt: epochMs("started_processing_at"),
    succeededAt: epochMs("succeeded_at"),
    failedAt: epochMs("failed_at"),
    providerInternals: jsonb("provider_internals")
      .$type<Payment["provider_internals"]>()
      .notNull(),
  },
  (t) => [idFormatCheck("payment", t), index("payments_tenant").on(t.tenant)],
);

export const paymentInvoices = pgTable(
  "payment_invoices",
  {
    payment: text("payment")
      .notNull()
      .references(() => payments.uniqueId),
    invoice: text("invoice")
      .notNull()
      .references(() => invoices.uniqueId),
  },
  (t) => [primaryKey({ columns: [t.payment, t.invoice] })],
);

export const refunds = pgTable(
  "refunds",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    createdAt: epochMs("created_at").notNull(),
    startedProcessingAt: epochMs("started_processing_at"),
    succeededAt: epochMs("succeeded_at"),
    failedAt: epochMs("failed_at"),
    byTeamMember: text("by_team_member")
      .notNull()
      .references(() => teamMembers.uniqueId),
    value: text("value")
      .notNull()
      .references(() => values.uniqueId),
    reason: text("reason"),
  },
  (t) => [idFormatCheck("refund", t)],
);

export const featureOverrides = pgTable(
  "feature_overrides",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    feature: text("feature")
      .notNull()
      .references(() => features.uniqueId),
    setTo: featureSetTo("set_to").notNull(),
    on: epochMs("on").notNull(),
    byTeamMember: text("by_team_member")
      .notNull()
      .references(() => teamMembers.uniqueId),
    reason: text("reason"),
  },
  (t) => [idFormatCheck("feature_override", t)],
);

export const meterOverrides = pgTable(
  "meter_overrides",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    meter: text("meter")
      .notNull()
      .references(() => meters.uniqueId),
    ...planMeterColumns,
    on: epochMs("on").notNull(),
    byTeamMember: text("by_team_member")
      .notNull()
      .references(() => teamMembers.uniqueId),
    reason: text("reason"),
  },
  (t) => [
    idFormatCheck("meter_override", t),
    limitGteDefaultCheck("meter_overrides"),
    check(
      "meter_overrides_default_nonnegative",
      sql`default_microcredits >= 0`,
    ),
    check("meter_overrides_limit_positive", sql`limit_microcredits > 0`),
  ],
);

export const creditGrants = pgTable(
  "credit_grants",
  {
    uniqueId: text("unique_id").primaryKey(),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    meter: text("meter")
      .notNull()
      .references(() => meters.uniqueId),
    on: epochMs("on").notNull(),
    byTeamMember: text("by_team_member")
      .notNull()
      .references(() => teamMembers.uniqueId),
    reason: text("reason"),
    amountMicrocredits: microcredits("amount_microcredits").notNull(),
    /**
     * When the grant was applied to the Redis balance, in MICROseconds on
     * the Redis server's clock (see meter_events.received_at). NULL means
     * "never applied" -- the reconciler applies such grants (idempotently).
     * Stamped at most once (UPDATE ... WHERE applied_at IS NULL) so replay
     * never double-counts a grant already folded into a checkpoint.
     */
    appliedAt: bigint("applied_at", { mode: "number" }),
  },
  (t) => [
    idFormatCheck("credit_grant", t),
    check("credit_grants_amount_positive", sql`amount_microcredits > 0`),
  ],
);

export const couponGrants = pgTable(
  "coupon_grants",
  {
    uniqueId: text("unique_id").primaryKey(),
    /** The tenant doing the granting. */
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    coupon: text("coupon")
      .notNull()
      .references(() => coupons.uniqueId),
    on: epochMs("on").notNull(),
    toTenant: text("to_tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    usedAt: epochMs("used_at"),
    reason: text("reason"),
  },
  (t) => [idFormatCheck("coupon_grant", t)],
);

export const couponReceipts = pgTable(
  "coupon_receipts",
  {
    uniqueId: text("unique_id").primaryKey(),
    /** The tenant that received the coupon. */
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    coupon: text("coupon")
      .notNull()
      .references(() => coupons.uniqueId),
    on: epochMs("on").notNull(),
    usedAt: epochMs("used_at"),
    reason: text("reason"),
    grantorType: grantorTypeEnum("grantor_type").notNull(),
    /** Exactly one of these is set, per grantor_type (see check). */
    byTeamMember: text("by_team_member").references(() => teamMembers.uniqueId),
    byTenant: text("by_tenant").references(() => tenants.uniqueId),
    byCouponGrant: text("by_coupon_grant").references(
      () => couponGrants.uniqueId,
    ),
  },
  (t) => [
    idFormatCheck("coupon_receipt", t),
    check(
      "coupon_receipts_grantor_variant",
      sql`(grantor_type = 'team_member' and by_team_member is not null and by_tenant is null and by_coupon_grant is null)
       or (grantor_type = 'tenant' and by_team_member is null and by_tenant is not null and by_coupon_grant is null)
       or (grantor_type = 'reciprocal' and by_team_member is null and by_tenant is null and by_coupon_grant is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Metering (hot path -- see api/cache/ for the Redis side)
// ---------------------------------------------------------------------------

export const meterEvents = pgTable(
  "meter_events",
  {
    uniqueId: text("unique_id").primaryKey(),
    /** The caller's idempotency key; defaults to unique_id at ingest. */
    uniqueExternalId: text("unique_external_id").notNull(),
    createdAt: epochMs("created_at").notNull(),
    /**
     * When the Redis ingest script applied the decrement, in MICROseconds
     * since the epoch on the Redis server's clock -- the same clock
     * meter_balances.updated_at uses, so rebuild replay
     * (received_at > updated_at) orders events against checkpoints exactly.
     * Null for events flushed before this column existed; those are already
     * folded into checkpoints and excluded from replay.
     */
    receivedAt: bigint("received_at", { mode: "number" }),
    meter: text("meter")
      .notNull()
      .references(() => meters.uniqueId),
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    amountMicrocredits: microcredits("amount_microcredits").notNull(),
    status: meterEventStatusEnum("status").notNull(),
  },
  (t) => [
    idFormatCheck("meter_event", t),
    check("meter_events_amount_nonzero", sql`amount_microcredits != 0`),
    // Idempotency backstop: the Redis dedupe window is finite, this is not.
    uniqueIndex("meter_events_idempotency").on(
      t.tenant,
      t.meter,
      t.uniqueExternalId,
    ),
    index("meter_events_tenant_meter_created").on(
      t.tenant,
      t.meter,
      t.createdAt,
    ),
  ],
);

/**
 * Checkpointed meter balances. Redis (api/cache/) is the hot path for
 * balance checks and decrements; this table is the durable copy balances
 * are checkpointed to and rebuilt from.
 */
export const meterBalances = pgTable(
  "meter_balances",
  {
    tenant: text("tenant")
      .notNull()
      .references(() => tenants.uniqueId),
    meter: text("meter")
      .notNull()
      .references(() => meters.uniqueId),
    balanceMicrocredits: microcredits("balance_microcredits").notNull(),
    updatedAt: epochMs("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant, t.meter] }),
    check("meter_balances_nonnegative", sql`balance_microcredits >= 0`),
  ],
);

/**
 * Dead-letter queue for meter events that repeatedly fail to flush into
 * meter_events (e.g. FK violations, corrupt payloads). A DLQ'd event DID
 * decrement the Redis balance if its status is "succeeded", so balance
 * rebuilds replay succeeded rows from here too -- excluding them would
 * rebuild balances too high. Deliberately no FK constraints: the reason a
 * row lands here may be that its tenant/meter reference is invalid.
 */
export const meterEventsDlq = pgTable("meter_events_dlq", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  /** The raw payload JSON from the pending stream, unmodified. */
  payload: text("payload").notNull(),
  /** Columns below are extracted when the payload parses; null otherwise. */
  status: meterEventStatusEnum("status"),
  tenant: text("tenant"),
  meter: text("meter"),
  amountMicrocredits: microcredits("amount_microcredits"),
  receivedAt: bigint("received_at", { mode: "number" }),
  /** Why the flush gave up (pg error code + message). */
  error: text("error").notNull(),
  failedAt: epochMs("failed_at").notNull(),
});
