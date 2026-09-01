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
import type { PaymentMethod } from "../schemas/payment-method.ts";
import type { PlanMeter } from "../schemas/plan.ts";

/** Check constraint enforcing "<prefix>_<suffix of [a-z0-9]>" id format. */
function idFormatCheck(prefix: IdPrefix, id: SQLWrapper) {
  // Inlined as a literal: check constraints can't take parameters.
  const pattern = `'^${prefix}_[a-z0-9]{${idSuffixLengths[prefix]}}$'`;
  return check(`${prefix}_id_format`, sql`${id} ~ ${sql.raw(pattern)}`);
}

/** Milliseconds since the unix epoch, as stored in the db. */
const epochMs = (name: string) => bigint(name, { mode: "number" });

/** Integer microcredits, as stored in the db. */
const microcredits = (name: string) => bigint(name, { mode: "number" });

/** A length of time: durationSchema, or a literal like "one_time". */
const duration = (name: string) => jsonb(name).$type<Duration>();

/** When credits expire or allocations reset. Null means "never". */
const resetSchedule = (name: string) =>
  jsonb(name).$type<Duration | "billing_cycle_end">();

/** What a feature is set to: boolean, or the list of enabled options. */
const featureSetTo = (name: string) => jsonb(name).$type<boolean | string[]>();

/** A price per usage tier (plan meter top-ups). */
const topUpPricesPerCredit = (name: string) =>
  jsonb(name).$type<PlanMeter["topUpPricesPerCredit"]>();

const topUpCreditPackSizes = (name: string) =>
  jsonb(name).$type<PlanMeter["topUpCreditPackSizes"]>();

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
  /** Duration, or "one_time" (upfront only). */
  cycleLength: jsonb("cycle_length").$type<Duration | "one_time">().notNull(),
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
    teamMemberId: text("team_member_id").primaryKey(),
    email: text("email").notNull().unique(),
    deletedAt: epochMs("deleted_at"),
    name: text("name"),
    profilePictureUrl: text("profile_picture_url"),
  },
  (t) => [idFormatCheck("team_member", t.teamMemberId)],
);

// ---------------------------------------------------------------------------
// Core pricing entities (immutable / versioned)
// ---------------------------------------------------------------------------

export const values = pgTable(
  "values",
  {
    valueId: text("value_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
    amounts: jsonb("amounts").$type<CurrencyAmount[]>().notNull(),
  },
  (t) => [idFormatCheck("value", t.valueId)],
);

export const cycles = pgTable(
  "cycles",
  {
    cycleId: text("cycle_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    defaultDiscountPercentage: doublePrecision("default_discount_percentage"),
    name: text("name").notNull(),
    description: text("description"),
    ...chargingColumns,
  },
  (t) => [idFormatCheck("cycle", t.cycleId), chargingCheck("cycles")],
);

export const taxTypes = pgTable(
  "tax_types",
  {
    taxTypeId: text("tax_type_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("tax_type", t.taxTypeId)],
);

export const taxes = pgTable(
  "taxes",
  {
    taxId: text("tax_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    taxTypeId: text("tax_type_id")
      .notNull()
      .references(() => taxTypes.taxTypeId),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("tax", t.taxId)],
);

export const features = pgTable(
  "features",
  {
    featureId: text("feature_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("feature", t.featureId)],
);

export const featureOptions = pgTable(
  "feature_options",
  {
    featureOptionId: text("feature_option_id").primaryKey(),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("feature_option", t.featureOptionId)],
);

/** feature.applicable_tax_type_ids, relational so the FK is enforced. */
export const featureTaxTypes = pgTable(
  "feature_tax_types",
  {
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    taxTypeId: text("tax_type_id")
      .notNull()
      .references(() => taxTypes.taxTypeId),
  },
  (t) => [primaryKey({ columns: [t.featureId, t.taxTypeId] })],
);

export const meters = pgTable(
  "meters",
  {
    meterId: text("meter_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("meter", t.meterId)],
);

/** meter.applicable_tax_type_ids, relational so the FK is enforced. */
export const meterTaxTypes = pgTable(
  "meter_tax_types",
  {
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    taxTypeId: text("tax_type_id")
      .notNull()
      .references(() => taxTypes.taxTypeId),
  },
  (t) => [primaryKey({ columns: [t.meterId, t.taxTypeId] })],
);

export const plans = pgTable(
  "plans",
  {
    planId: text("plan_id").primaryKey(),
    /** The plan this version was derived from, if any. */
    derivedFromPlanId: text("derived_from_plan_id").references(
      (): AnyPgColumn => plans.planId,
    ),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    /** Fixed term for loan-style plans; null means open-ended. */
    duration: duration("duration"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("plan", t.planId)],
);

export const planPrices = pgTable(
  "plan_prices",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.cycleId),
    /** Monetary price, when the row is a monetary variant. */
    valueId: text("value_id").references(() => values.valueId),
    /** Interest price, when the row is an interest variant. */
    interestPercentage: doublePrecision("interest_percentage"),
    minimumPaymentValueId: text("minimum_payment_value_id").references(
      () => values.valueId,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.cycleId] }),
    // A price is either monetary (value_id set) or interest
    // (interest_percentage + minimum_payment_value_id set).
    check(
      "plan_prices_variant",
      sql`(value_id is not null and interest_percentage is null and minimum_payment_value_id is null)
       or (value_id is null and interest_percentage is not null and minimum_payment_value_id is not null)`,
    ),
  ],
);

export const planFeatures = pgTable(
  "plan_features",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    setTo: featureSetTo("set_to").notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.featureId] })],
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
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    ...planMeterColumns,
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.meterId] }),
    limitGteDefaultCheck("plan_meters"),
    check("plan_meters_default_nonnegative", sql`default_microcredits >= 0`),
    check("plan_meters_limit_positive", sql`limit_microcredits > 0`),
  ],
);

export const planAddOns = pgTable(
  "plan_add_ons",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    addOnId: text("add_on_id")
      .notNull()
      .references(() => addOns.addOnId),
  },
  (t) => [primaryKey({ columns: [t.planId, t.addOnId] })],
);

export const addOns = pgTable(
  "add_ons",
  {
    addOnId: text("add_on_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("add_on", t.addOnId)],
);

export const addOnPrices = pgTable(
  "add_on_prices",
  {
    addOnId: text("add_on_id")
      .notNull()
      .references(() => addOns.addOnId),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.cycleId),
    valueId: text("value_id")
      .notNull()
      .references(() => values.valueId),
  },
  (t) => [primaryKey({ columns: [t.addOnId, t.cycleId] })],
);

export const addOnFeatures = pgTable(
  "add_on_features",
  {
    addOnId: text("add_on_id")
      .notNull()
      .references(() => addOns.addOnId),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    setTo: featureSetTo("set_to").notNull(),
  },
  (t) => [primaryKey({ columns: [t.addOnId, t.featureId] })],
);

/**
 * Reusable coupon definitions (e.g. "the referral coupon"). Templates are
 * deprecated, never deleted: coupons minted from one keep the definition
 * they copied at creation.
 */
export const couponTemplates = pgTable(
  "coupon_templates",
  {
    couponTemplateId: text("coupon_template_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    grantableByTenants: boolean("grantable_by_tenants").notNull(),
    /** Only settable when grantable_by_tenants. Null means no limit. */
    limitPerGrantingTenant: integer("limit_per_granting_tenant"),
    name: text("name").notNull(),
    description: text("description"),
    defaultAward: jsonb("default_award").$type<Award>(),
    /** Only settable when grantable_by_tenants. */
    reciprocalBenefitCouponTemplateId: text(
      "reciprocal_benefit_coupon_template_id",
    ).references((): AnyPgColumn => couponTemplates.couponTemplateId),
  },
  (t) => [
    idFormatCheck("coupon_template", t.couponTemplateId),
    check(
      "coupon_templates_grantable_gating",
      sql`grantable_by_tenants or (limit_per_granting_tenant is null and reciprocal_benefit_coupon_template_id is null)`,
    ),
  ],
);

export const couponTemplateFeaturesGranted = pgTable(
  "coupon_template_features_granted",
  {
    couponTemplateId: text("coupon_template_id")
      .notNull()
      .references(() => couponTemplates.couponTemplateId),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    setTo: featureSetTo("set_to").notNull(),
    award: jsonb("award").$type<Award>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.couponTemplateId, t.featureId] })],
);

export const couponTemplateCreditsGranted = pgTable(
  "coupon_template_credits_granted",
  {
    couponTemplateId: text("coupon_template_id")
      .notNull()
      .references(() => couponTemplates.couponTemplateId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    amountMicrocredits: microcredits("amount_microcredits").notNull(),
    /** Null means the credits never expire. */
    expiration: resetSchedule("expiration"),
    /** Null means unlimited rollovers. */
    rollovers: integer("rollovers"),
    award: jsonb("award").$type<Award>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.couponTemplateId, t.meterId] }),
    check(
      "coupon_template_credits_amount_positive",
      sql`amount_microcredits > 0`,
    ),
  ],
);

export const coupons = pgTable(
  "coupons",
  {
    couponId: text("coupon_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    /** Coupons are consumables, so they're deleted, not deprecated. */
    deletedAt: epochMs("deleted_at"),
    /** The template this coupon's definition was copied from, if any. */
    templateId: text("template_id").references(
      () => couponTemplates.couponTemplateId,
    ),
    grantableByTenants: boolean("grantable_by_tenants").notNull(),
    /** Only settable when grantable_by_tenants. Null means no limit. */
    limitPerGrantingTenant: integer("limit_per_granting_tenant"),
    name: text("name").notNull(),
    description: text("description"),
    defaultAward: jsonb("default_award").$type<Award>(),
    /** Only settable when grantable_by_tenants. */
    reciprocalBenefitCouponId: text("reciprocal_benefit_coupon_id").references(
      (): AnyPgColumn => coupons.couponId,
    ),
  },
  (t) => [
    idFormatCheck("coupon", t.couponId),
    check(
      "coupons_grantable_gating",
      sql`grantable_by_tenants or (limit_per_granting_tenant is null and reciprocal_benefit_coupon_id is null)`,
    ),
  ],
);

export const couponFeaturesGranted = pgTable(
  "coupon_features_granted",
  {
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.couponId),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    setTo: featureSetTo("set_to").notNull(),
    award: jsonb("award").$type<Award>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.couponId, t.featureId] })],
);

export const couponCreditsGranted = pgTable(
  "coupon_credits_granted",
  {
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.couponId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    amountMicrocredits: microcredits("amount_microcredits").notNull(),
    /** Null means the credits never expire. */
    expiration: resetSchedule("expiration"),
    /** Null means unlimited rollovers. */
    rollovers: integer("rollovers"),
    award: jsonb("award").$type<Award>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.couponId, t.meterId] }),
    check("coupon_credits_amount_positive", sql`amount_microcredits > 0`),
  ],
);

export const experiments = pgTable(
  "experiments",
  {
    experimentId: text("experiment_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    concludedAt: epochMs("concluded_at"),
    concludingPlanId: text("concluding_plan_id").references(() => plans.planId),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("experiment", t.experimentId)],
);

export const experimentTreatments = pgTable(
  "experiment_treatments",
  {
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.experimentId),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    tenantPercentage: doublePrecision("tenant_percentage").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.planId] }),
    check(
      "experiment_treatments_percentage_range",
      sql`tenant_percentage >= 0 and tenant_percentage <= 100`,
    ),
  ],
);

/**
 * Treatment-level tenant assignments (treatment.assigned_tenant_ids),
 * relational so the FK is enforced and "which treatment is this tenant in"
 * stays fast.
 */
export const experimentTreatmentTenants = pgTable(
  "experiment_treatment_tenants",
  {
    experimentId: text("experiment_id").notNull(),
    planId: text("plan_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.tenantId] }),
    foreignKey({
      columns: [t.experimentId, t.planId],
      foreignColumns: [
        experimentTreatments.experimentId,
        experimentTreatments.planId,
      ],
    }),
    index("experiment_treatment_tenants_tenant").on(t.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// Tenants and everything scoped to one
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  "tenants",
  {
    tenantId: text("tenant_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deletedAt: epochMs("deleted_at"),
    externalIds: jsonb("external_ids")
      .$type<Record<string, string>>()
      .notNull(),
  },
  (t) => [idFormatCheck("tenant", t.tenantId)],
);

export const assignments = pgTable(
  "assignments",
  {
    assignmentId: text("assignment_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    /** Set when the assignment came from an experiment treatment. */
    experimentId: text("experiment_id").references(
      () => experiments.experimentId,
    ),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.cycleId),
    startsAt: epochMs("starts_at").notNull(),
    endsAt: epochMs("ends_at"),
  },
  (t) => [
    idFormatCheck("assignment", t.assignmentId),
    index("assignments_tenant").on(t.tenantId),
  ],
);

export const assignmentAddOns = pgTable(
  "assignment_add_ons",
  {
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.assignmentId),
    addOnId: text("add_on_id")
      .notNull()
      .references(() => addOns.addOnId),
    startsAt: epochMs("starts_at").notNull(),
    endsAt: epochMs("ends_at"),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.addOnId, t.startsAt] })],
);

export const loans = pgTable(
  "loans",
  {
    loanId: text("loan_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.assignmentId),
    createdAt: epochMs("created_at").notNull(),
    closedAt: epochMs("closed_at"),
    principal: jsonb("principal").$type<CurrencyAmount>().notNull(),
  },
  (t) => [idFormatCheck("loan", t.loanId), index("loans_tenant").on(t.tenantId)],
);

export const invoices = pgTable(
  "invoices",
  {
    invoiceId: text("invoice_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    createdAt: epochMs("created_at").notNull(),
    closedAt: epochMs("closed_at"),
    closedReason: text("closed_reason"),
    ...chargingColumns,
  },
  (t) => [
    idFormatCheck("invoice", t.invoiceId),
    chargingCheck("invoices"),
    index("invoices_tenant").on(t.tenantId),
  ],
);

export const items = pgTable(
  "items",
  {
    itemId: text("item_id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.invoiceId),
    perUnitValueId: text("per_unit_value_id")
      .notNull()
      .references(() => values.valueId),
    units: doublePrecision("units").notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [
    idFormatCheck("item", t.itemId),
    check("items_units_nonnegative", sql`units >= 0`),
  ],
);

export const taxationAmounts = pgTable(
  "taxation_amounts",
  {
    taxationAmountId: text("taxation_amount_id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.invoiceId),
    taxId: text("tax_id")
      .notNull()
      .references(() => taxes.taxId),
    description: text("description"),
    amount: jsonb("amount").$type<CurrencyAmount>().notNull(),
  },
  (t) => [idFormatCheck("taxation_amount", t.taxationAmountId)],
);

/** taxation_amount.applies_to_item_ids, relational so the FK is enforced. */
export const taxationAmountItems = pgTable(
  "taxation_amount_items",
  {
    taxationAmountId: text("taxation_amount_id")
      .notNull()
      .references(() => taxationAmounts.taxationAmountId),
    itemId: text("item_id")
      .notNull()
      .references(() => items.itemId),
  },
  (t) => [primaryKey({ columns: [t.taxationAmountId, t.itemId] })],
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    paymentMethodId: text("payment_method_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    createdAt: epochMs("created_at").notNull(),
    deletedAt: epochMs("deleted_at"),
    isDefault: boolean("is_default").notNull(),
    /** Provider references only -- no payment details on our servers. */
    providerInternals: jsonb("provider_internals")
      .$type<PaymentMethod["providerInternals"]>()
      .notNull(),
  },
  (t) => [
    idFormatCheck("payment_method", t.paymentMethodId),
    // At most one active default payment method per tenant.
    uniqueIndex("payment_methods_one_default")
      .on(t.tenantId)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    paymentId: text("payment_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    createdAt: epochMs("created_at").notNull(),
    startedProcessingAt: epochMs("started_processing_at"),
    succeededAt: epochMs("succeeded_at"),
    failedAt: epochMs("failed_at"),
    providerInternals: jsonb("provider_internals")
      .$type<Payment["providerInternals"]>()
      .notNull(),
  },
  (t) => [
    idFormatCheck("payment", t.paymentId),
    index("payments_tenant").on(t.tenantId),
  ],
);

export const paymentInvoices = pgTable(
  "payment_invoices",
  {
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.paymentId),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.invoiceId),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.invoiceId] })],
);

export const refunds = pgTable(
  "refunds",
  {
    refundId: text("refund_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    createdAt: epochMs("created_at").notNull(),
    startedProcessingAt: epochMs("started_processing_at"),
    succeededAt: epochMs("succeeded_at"),
    failedAt: epochMs("failed_at"),
    byTeamMemberId: text("by_team_member_id")
      .notNull()
      .references(() => teamMembers.teamMemberId),
    valueId: text("value_id")
      .notNull()
      .references(() => values.valueId),
    reason: text("reason"),
  },
  (t) => [idFormatCheck("refund", t.refundId)],
);

export const featureOverrides = pgTable(
  "feature_overrides",
  {
    featureOverrideId: text("feature_override_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    setTo: featureSetTo("set_to").notNull(),
    createdAt: epochMs("created_at").notNull(),
    byTeamMemberId: text("by_team_member_id")
      .notNull()
      .references(() => teamMembers.teamMemberId),
    reason: text("reason"),
  },
  (t) => [idFormatCheck("feature_override", t.featureOverrideId)],
);

export const meterOverrides = pgTable(
  "meter_overrides",
  {
    meterOverrideId: text("meter_override_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    ...planMeterColumns,
    createdAt: epochMs("created_at").notNull(),
    byTeamMemberId: text("by_team_member_id")
      .notNull()
      .references(() => teamMembers.teamMemberId),
    reason: text("reason"),
  },
  (t) => [
    idFormatCheck("meter_override", t.meterOverrideId),
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
    creditGrantId: text("credit_grant_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    grantedAt: epochMs("granted_at").notNull(),
    byTeamMemberId: text("by_team_member_id")
      .notNull()
      .references(() => teamMembers.teamMemberId),
    reason: text("reason"),
    amountMicrocredits: microcredits("amount_microcredits").notNull(),
    /**
     * When the grant was applied to the Redis balance, in MICROseconds on
     * the Redis server's clock (see meter_events.received_at_micros). NULL
     * means "never applied" -- the reconciler applies such grants
     * (idempotently). Stamped at most once (UPDATE ... WHERE applied_at_micros
     * IS NULL) so replay never double-counts a grant already folded into a
     * checkpoint.
     */
    appliedAtMicros: bigint("applied_at_micros", { mode: "number" }),
  },
  (t) => [
    idFormatCheck("credit_grant", t.creditGrantId),
    check("credit_grants_amount_positive", sql`amount_microcredits > 0`),
  ],
);

export const couponGrants = pgTable(
  "coupon_grants",
  {
    couponGrantId: text("coupon_grant_id").primaryKey(),
    /** The tenant doing the granting. */
    fromTenantId: text("from_tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.couponId),
    grantedAt: epochMs("granted_at").notNull(),
    toTenantId: text("to_tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    usedAt: epochMs("used_at"),
    reason: text("reason"),
  },
  (t) => [idFormatCheck("coupon_grant", t.couponGrantId)],
);

export const couponReceipts = pgTable(
  "coupon_receipts",
  {
    couponReceiptId: text("coupon_receipt_id").primaryKey(),
    /** The tenant that received the coupon. */
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.couponId),
    receivedAt: epochMs("received_at").notNull(),
    usedAt: epochMs("used_at"),
    reason: text("reason"),
    grantorType: grantorTypeEnum("grantor_type").notNull(),
    /** Exactly one of these is set, per grantor_type (see check). */
    byTeamMemberId: text("by_team_member_id").references(
      () => teamMembers.teamMemberId,
    ),
    byTenantId: text("by_tenant_id").references(() => tenants.tenantId),
    byCouponGrantId: text("by_coupon_grant_id").references(
      () => couponGrants.couponGrantId,
    ),
  },
  (t) => [
    idFormatCheck("coupon_receipt", t.couponReceiptId),
    check(
      "coupon_receipts_grantor_variant",
      sql`(grantor_type = 'team_member' and by_team_member_id is not null and by_tenant_id is null and by_coupon_grant_id is null)
       or (grantor_type = 'tenant' and by_team_member_id is null and by_tenant_id is not null and by_coupon_grant_id is null)
       or (grantor_type = 'reciprocal' and by_team_member_id is null and by_tenant_id is null and by_coupon_grant_id is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Metering (hot path -- see api/cache/ for the Redis side)
// ---------------------------------------------------------------------------

export const meterEvents = pgTable(
  "meter_events",
  {
    meterEventId: text("meter_event_id").primaryKey(),
    /** The caller's idempotency key; defaults to id at ingest. */
    externalId: text("external_id").notNull(),
    createdAt: epochMs("created_at").notNull(),
    /**
     * When the Redis ingest script applied the decrement, in MICROseconds
     * since the epoch on the Redis server's clock -- the same clock
     * meter_balances.updated_at uses, so rebuild replay
     * (received_at_micros > updated_at) orders events against checkpoints
     * exactly. Null for events flushed before this column existed; those are
     * already folded into checkpoints and excluded from replay.
     */
    receivedAtMicros: bigint("received_at_micros", { mode: "number" }),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    amountMicrocredits: microcredits("amount_microcredits").notNull(),
    status: meterEventStatusEnum("status").notNull(),
  },
  (t) => [
    idFormatCheck("meter_event", t.meterEventId),
    check("meter_events_amount_nonzero", sql`amount_microcredits != 0`),
    // Idempotency backstop: the Redis dedupe window is finite, this is not.
    uniqueIndex("meter_events_idempotency").on(
      t.tenantId,
      t.meterId,
      t.externalId,
    ),
    index("meter_events_tenant_meter_created").on(
      t.tenantId,
      t.meterId,
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
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    balanceMicrocredits: microcredits("balance_microcredits").notNull(),
    updatedAt: epochMs("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.meterId] }),
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
  meterEventDlqId: bigint("meter_event_dlq_id", { mode: "number" })
    .generatedAlwaysAsIdentity()
    .primaryKey(),
  /** The raw payload JSON from the pending stream, unmodified. */
  payload: text("payload").notNull(),
  /** Columns below are extracted when the payload parses; null otherwise. */
  status: meterEventStatusEnum("status"),
  tenantId: text("tenant_id"),
  meterId: text("meter_id"),
  amountMicrocredits: microcredits("amount_microcredits"),
  receivedAtMicros: bigint("received_at_micros", { mode: "number" }),
  /** Why the flush gave up (pg error code + message). */
  error: text("error").notNull(),
  failedAt: epochMs("failed_at").notNull(),
});
