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
import { idSuffixLengths, type IdPrefix } from "../schemas/ids.ts";
import type {
  LoanServicingState,
  LoanServicingTerms,
} from "../schemas/loan-servicing.ts";
import type { Payment } from "../schemas/payment.ts";
import type { PaymentMethod } from "../schemas/payment-method.ts";
import type { PlanMeter } from "../schemas/plan.ts";
import type { FiringPayload, Rule } from "../schemas/rule.ts";
import type { IntegrationTarget } from "../schemas/task-type.ts";
import type { ExternalRef } from "../schemas/task.ts";

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

/* Number.MAX_SAFE_INTEGER, inlined as a literal: check constraints can't take
 * parameters. Bounds jsonb-stored amounts, which lose precision past this. */
const jsonbSafeInteger = sql.raw("9007199254740991");

/** Numeric value of a CurrencyAmount jsonb column. */
const amountValue = (column: SQLWrapper) => sql`(${column}->>'value')::numeric`;

/** Column holds an integer within the jsonb-safe amount range. */
const jsonbSafeAmount = (column: SQLWrapper) =>
  sql`${column} between 0 and ${jsonbSafeInteger}`;

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
};

/** Upfront rows carry no arrears-only fields; arrears rows require them. */
function chargingCheck(table: string) {
  return check(
    `${table}_charging_variant`,
    sql`(charged = 'upfront' and credit_period is null and grace_period is null)
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
    createdAt: epochMs("created_at").notNull(),
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

export const productLines = pgTable(
  "product_lines",
  {
    productLineId: text("product_line_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    /* Line ids this one's billing cycle is forced into sync with. Array
     * elements can't FK in Postgres; targets are validated in the service. */
    forceBillingCycleSynchronizationWithProductLineIds: text(
      "force_billing_cycle_synchronization_with_product_line_ids",
    )
      .array()
      .notNull()
      .default([]),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("product_line", t.productLineId)],
);

export const features = pgTable(
  "features",
  {
    featureId: text("feature_id").primaryKey(),
    productLineId: text("product_line_id")
      .notNull()
      .references(() => productLines.productLineId),
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
    /* The lines this meter applies to. Array elements can't FK in Postgres;
     * line membership is validated in the service. */
    productLineIds: text("product_line_ids").array().notNull(),
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
    productLineId: text("product_line_id")
      .notNull()
      .references(() => productLines.productLineId),
    /** The plan this version was derived from, if any. */
    derivedFromPlanId: text("derived_from_plan_id").references(
      (): AnyPgColumn => plans.planId,
    ),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
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
    valueId: text("value_id")
      .notNull()
      .references(() => values.valueId),
  },
  (t) => [primaryKey({ columns: [t.planId, t.cycleId] })],
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

export const planAddOnTypes = pgTable(
  "plan_add_on_types",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
    addOnTypeId: text("add_on_type_id")
      .notNull()
      .references(() => addOnTypes.addOnTypeId),
  },
  (t) => [primaryKey({ columns: [t.planId, t.addOnTypeId] })],
);

export const addOnTypes = pgTable(
  "add_on_types",
  {
    addOnTypeId: text("add_on_type_id").primaryKey(),
    productLineId: text("product_line_id")
      .notNull()
      .references(() => productLines.productLineId),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("add_on_type", t.addOnTypeId)],
);

export const addOnTypePrices = pgTable(
  "add_on_type_prices",
  {
    addOnTypeId: text("add_on_type_id")
      .notNull()
      .references(() => addOnTypes.addOnTypeId),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.cycleId),
    valueId: text("value_id")
      .notNull()
      .references(() => values.valueId),
  },
  (t) => [primaryKey({ columns: [t.addOnTypeId, t.cycleId] })],
);

export const addOnTypeFeatures = pgTable(
  "add_on_type_features",
  {
    addOnTypeId: text("add_on_type_id")
      .notNull()
      .references(() => addOnTypes.addOnTypeId),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.featureId),
    setTo: featureSetTo("set_to").notNull(),
  },
  (t) => [primaryKey({ columns: [t.addOnTypeId, t.featureId] })],
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
    couponTemplateId: text("coupon_template_id").references(
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

/**
 * Reusable loan definitions. Templates are deprecated, never deleted:
 * loans minted from one keep the definition they copied at creation.
 */
export const loanTemplates = pgTable(
  "loan_templates",
  {
    loanTemplateId: text("loan_template_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    name: text("name").notNull(),
    description: text("description"),
    principal: jsonb("principal").$type<CurrencyAmount>().notNull(),
    annualInterestPercentage: doublePrecision(
      "annual_interest_percentage",
    ).notNull(),
    servicingTerms: jsonb("servicing_terms").$type<LoanServicingTerms>(),
    /** Fixed term: a loan minted from this template is due created_at + duration. */
    duration: duration("duration").notNull(),
  },
  (t) => [idFormatCheck("loan_template", t.loanTemplateId)],
);

export const experiments = pgTable(
  "experiments",
  {
    experimentId: text("experiment_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    concludedAt: epochMs("concluded_at"),
    /** The plan to set per product line on conclusion (planId null = end). */
    concludingPlans:
      jsonb("concluding_plans").$type<
        { productLineId: string; planId: string | null }[]
      >(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("experiment", t.experimentId)],
);

/**
 * One bucket of an experiment: a set of plans (at most one per product
 * line), so a treatment can span lines. The plan set is relational so the
 * plan FK is enforced.
 */
export const experimentTreatments = pgTable(
  "experiment_treatments",
  {
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.experimentId),
    treatmentId: text("treatment_id").notNull(),
    tenantPercentage: doublePrecision("tenant_percentage").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.treatmentId] }),
    idFormatCheck("treatment", t.treatmentId),
    check(
      "experiment_treatments_percentage_range",
      sql`tenant_percentage >= 0 and tenant_percentage <= 100`,
    ),
  ],
);

/** treatment.planIds, relational so the FK is enforced. */
export const experimentTreatmentPlans = pgTable(
  "experiment_treatment_plans",
  {
    experimentId: text("experiment_id").notNull(),
    treatmentId: text("treatment_id").notNull(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.planId),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.treatmentId, t.planId] }),
    foreignKey({
      columns: [t.experimentId, t.treatmentId],
      foreignColumns: [
        experimentTreatments.experimentId,
        experimentTreatments.treatmentId,
      ],
    }),
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
    treatmentId: text("treatment_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.tenantId] }),
    foreignKey({
      columns: [t.experimentId, t.treatmentId],
      foreignColumns: [
        experimentTreatments.experimentId,
        experimentTreatments.treatmentId,
      ],
    }),
    index("experiment_treatment_tenants_tenant").on(t.tenantId),
  ],
);

/**
 * A category of task (analogous to tax/tax-type): shared behavior and the
 * external systems every instance routes to. See schemas/task-type.ts.
 */
export const taskTypes = pgTable(
  "task_types",
  {
    taskTypeId: text("task_type_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    defaultAssigneeTeamMemberId: text(
      "default_assignee_team_member_id",
    ).references(() => teamMembers.teamMemberId),
    integrations: jsonb("integrations").$type<IntegrationTarget[]>(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("task_type", t.taskTypeId)],
);

/**
 * A metering- or lifecycle-triggered action item (generalizes dunning).
 * scope/trigger/actions are self-contained value objects stored as jsonb;
 * evaluation lives in api/v0/rule/ and the scheduler in api/cache/. See
 * schemas/rule.ts.
 */
export const rules = pgTable(
  "rules",
  {
    ruleId: text("rule_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deprecatedAt: epochMs("deprecated_at"),
    scope: jsonb("scope").$type<Rule["scope"]>().notNull(),
    trigger: jsonb("trigger").$type<Rule["trigger"]>().notNull(),
    recurrence: jsonb("recurrence").$type<Rule["recurrence"]>().notNull(),
    actions: jsonb("actions").$type<Rule["actions"]>().notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [idFormatCheck("rule", t.ruleId)],
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
    /* Denormalized from the plan (checked at create) so the one-open-per-line
     * index lives here without a join. */
    productLineId: text("product_line_id")
      .notNull()
      .references(() => productLines.productLineId),
    createdAt: epochMs("created_at").notNull(),
    startsAt: epochMs("starts_at").notNull(),
    endsAt: epochMs("ends_at"),
  },
  (t) => [
    idFormatCheck("assignment", t.assignmentId),
    index("assignments_tenant").on(t.tenantId),
    /* A tenant may hold several open assignments, but at most one per product
     * line: overlapping lines would make meters and cycles ambiguous. */
    uniqueIndex("assignments_one_open_per_line")
      .on(t.tenantId, t.productLineId)
      .where(sql`${t.endsAt} is null`),
  ],
);

export const assignmentAddOns = pgTable(
  "assignment_add_ons",
  {
    addOnId: text("add_on_id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.assignmentId),
    addOnTypeId: text("add_on_type_id")
      .notNull()
      .references(() => addOnTypes.addOnTypeId),
    createdAt: epochMs("created_at").notNull(),
    startsAt: epochMs("starts_at").notNull(),
    endsAt: epochMs("ends_at"),
    /** Manually deleted ahead of the end, whether or not one is set. */
    deletedAt: epochMs("deleted_at"),
  },
  (t) => [idFormatCheck("add_on", t.addOnId)],
);

export const loans = pgTable(
  "loans",
  {
    loanId: text("loan_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    /** Set when the loan funds an assignment (e.g. BNPL); null when standalone. */
    assignmentId: text("assignment_id").references(
      () => assignments.assignmentId,
    ),
    createdAt: epochMs("created_at").notNull(),
    closedAt: epochMs("closed_at"),
    /** When repayment is due: created_at + duration, stamped at creation. */
    endsAt: epochMs("ends_at").notNull(),
    /** Removed ahead of resolution, whether or not one is set. */
    deletedAt: epochMs("deleted_at"),
    /** The template this loan's definition was copied from, if any. */
    loanTemplateId: text("loan_template_id").references(
      () => loanTemplates.loanTemplateId,
    ),
    principal: jsonb("principal").$type<CurrencyAmount>().notNull(),
    annualInterestPercentage: doublePrecision(
      "annual_interest_percentage",
    ).notNull(),
    servicingTerms: jsonb("servicing_terms").$type<LoanServicingTerms>(),
    servicingState: jsonb("servicing_state").$type<LoanServicingState>(),
    duration: duration("duration").notNull(),
  },
  (t) => {
    /* Servicing is all-or-nothing: unserviced loans carry no servicing
     * columns; serviced loans require terms and a state checkpoint. */
    const unserviced = sql`${t.servicingTerms} is null and ${t.servicingState} is null`;
    const serviced = sql`${t.servicingTerms} is not null and ${t.servicingState} is not null`;
    return [
      idFormatCheck("loan", t.loanId),
      index("loans_tenant").on(t.tenantId),
      check("loans_servicing_enabled", sql`(${unserviced}) or (${serviced})`),
    ];
  },
);

/** A loan's materialized repayment schedule (BNPL installments). */
export const loanInstallments = pgTable(
  "loan_installments",
  {
    installmentId: text("installment_id").primaryKey(),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.loanId),
    createdAt: epochMs("created_at").notNull(),
    dueAt: epochMs("due_at").notNull(),
    amount: jsonb("amount").$type<CurrencyAmount>().notNull(),
    paidAt: epochMs("paid_at"),
    allocatedAmount: bigint("allocated_amount", { mode: "number" }),
    canceledAt: epochMs("canceled_at"),
  },
  (t) => [
    idFormatCheck("installment", t.installmentId),
    index("loan_installments_loan").on(t.loanId),
    index("loan_installments_open")
      .on(t.loanId, t.dueAt)
      .where(
        sql`${t.canceledAt} is null and ${t.allocatedAmount} < ${amountValue(t.amount)}`,
      ),
    check(
      "loan_installments_allocation",
      sql`${t.allocatedAmount} is null or (${t.allocatedAmount} >= 0 and ${t.allocatedAmount} <= ${amountValue(t.amount)})`,
    ),
  ],
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
    /* The lifecycle rule scheduler scans recently-closed invoices per tick
     * with no tenant predicate, so the tenant-composite index can't serve
     * that scan; a partial closed_at index does, and stays small by
     * covering only the rows the scan can match. */
    index("invoices_closed")
      .on(t.closedAt)
      .where(sql`${t.closedAt} is not null`),
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
    uniqueIndex("payments_provider").on(
      t.tenantId,
      sql`(${t.providerInternals}->>'provider')`,
      sql`(${t.providerInternals}->>'paymentId')`,
    ),
  ],
);

/* Loan repayments: at most one per payment, recording the interest/principal
 * split once the payment succeeds. Mirrors payment_invoices for loan targets. */
export const paymentLoans = pgTable(
  "payment_loans",
  {
    paymentId: text("payment_id")
      .primaryKey()
      .references(() => payments.paymentId),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.loanId),
    amount: jsonb("amount").$type<CurrencyAmount>().notNull(),
    principalAmount: bigint("principal_amount", { mode: "number" }),
    interestAmount: bigint("interest_amount", { mode: "number" }),
  },
  (t) => {
    /* `is true` rejects the null-propagation cases the OR leaves over. */
    const unallocated = sql`${t.principalAmount} is null and ${t.interestAmount} is null`;
    const allocated = sql`${jsonbSafeAmount(t.principalAmount)} and ${jsonbSafeAmount(t.interestAmount)} and ${t.principalAmount} + ${t.interestAmount} = ${amountValue(t.amount)}`;
    return [
      index("payment_loans_loan").on(t.loanId),
      check(
        "payment_loans_amount",
        sql`${amountValue(t.amount)} between 1 and ${jsonbSafeInteger}`,
      ),
      check(
        "payment_loans_allocation",
        sql`((${unallocated}) or (${allocated})) is true`,
      ),
    ];
  },
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
    paymentId: text("payment_id").references(() => payments.paymentId),
    loanPrincipalAmount: bigint("loan_principal_amount", { mode: "number" }),
    loanInterestAmount: bigint("loan_interest_amount", { mode: "number" }),
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
  (t) => {
    /* Loan refunds restore the original payment's split once settled.
     * `is true` rejects the null-propagation cases the OR leaves over. */
    const unallocated = sql`${t.loanPrincipalAmount} is null and ${t.loanInterestAmount} is null`;
    const allocated = sql`${t.paymentId} is not null and ${t.succeededAt} is not null and ${t.failedAt} is null and ${jsonbSafeAmount(t.loanPrincipalAmount)} and ${jsonbSafeAmount(t.loanInterestAmount)} and ${t.loanPrincipalAmount} + ${t.loanInterestAmount} > 0`;
    return [
      idFormatCheck("refund", t.refundId),
      index("refunds_payment").on(t.paymentId),
      check(
        "refunds_loan_allocation",
        sql`((${unallocated}) or (${allocated})) is true`,
      ),
    ];
  },
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

/**
 * An internal action item. Operational data, so deleted (deleted_at), not
 * deprecated. external_refs holds sync handles to external trackers. See
 * schemas/task.ts.
 */
export const tasks = pgTable(
  "tasks",
  {
    taskId: text("task_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    deletedAt: epochMs("deleted_at"),
    taskTypeId: text("task_type_id")
      .notNull()
      .references(() => taskTypes.taskTypeId),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    sourceRuleId: text("source_rule_id").references(() => rules.ruleId),
    title: text("title").notNull(),
    description: text("description"),
    assignedToTeamMemberId: text("assigned_to_team_member_id").references(
      () => teamMembers.teamMemberId,
    ),
    completedAt: epochMs("completed_at"),
    externalRefs: jsonb("external_refs").$type<ExternalRef[]>(),
  },
  (t) => [
    idFormatCheck("task", t.taskId),
    index("tasks_tenant").on(t.tenantId),
    index("tasks_type").on(t.taskTypeId),
  ],
);

/**
 * One durable execution of a single rule action for a single firing.
 * Inserted synchronously when a rule fires (the firing is never lost), then
 * drained by the executor worker with retries. The (rule_id, tenant_id,
 * trigger_key, action_index) unique index is the idempotency backstop. See
 * schemas/rule-run.ts.
 */
export const ruleRuns = pgTable(
  "rule_runs",
  {
    ruleRunId: text("rule_run_id").primaryKey(),
    createdAt: epochMs("created_at").notNull(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.ruleId),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    triggerKey: text("trigger_key").notNull(),
    actionIndex: integer("action_index").notNull(),
    payload: jsonb("payload").$type<FiringPayload>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: epochMs("available_at").notNull(),
    /* Set while a worker holds the row; a claim older than the lease is
     * stale (its worker died mid-execution) and reclaimable. */
    claimedAt: epochMs("claimed_at"),
    succeededAt: epochMs("succeeded_at"),
    failedAt: epochMs("failed_at"),
    lastError: text("last_error"),
  },
  (t) => [
    idFormatCheck("rule_run", t.ruleRunId),
    uniqueIndex("rule_runs_idempotency").on(
      t.ruleId,
      t.tenantId,
      t.triggerKey,
      t.actionIndex,
    ),
    /* The claim query scans only the live queue; the partial predicate keeps
     * the index from growing with finished rows. */
    index("rule_runs_pending")
      .on(t.availableAt)
      .where(sql`${t.succeededAt} is null and ${t.failedAt} is null`),
    // firingKey's per-window quota count scopes to one rule+tenant, recent rows.
    index("rule_runs_rule_tenant_created").on(
      t.ruleId,
      t.tenantId,
      t.createdAt,
    ),
  ],
);

/**
 * Per-rule scheduler high-water mark: the newest lifecycle timestamp already
 * evaluated, so each tick scans only invoices closed since the last one
 * instead of the full closed history. One row per rule; absent = start at 0.
 */
export const ruleSchedulerState = pgTable("rule_scheduler_state", {
  ruleId: text("rule_id")
    .primaryKey()
    .references(() => rules.ruleId),
  /** Newest lifecycle timestamp (epoch ms) already evaluated for this rule. */
  evaluatedThroughMs: epochMs("evaluated_through_ms").notNull(),
});

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
    // The inactive_for scheduler scans recent events per meter.
    index("meter_events_meter_received").on(t.meterId, t.receivedAtMicros),
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
 * Checkpointed cumulative spend. Redis (api/cache/) INCRBYs a flat spend
 * counter on the ingest hot path; this table is the durable copy spend is
 * checkpointed to and rebuilt from. Spend-since-cycle-start is read at
 * evaluation time as this durable base plus the pg sum of events received
 * after the checkpoint (the flush-lag delta), so no billing-cycle anchor ever
 * touches the ingest hot path. Mirrors meter_balances exactly.
 */
export const meterSpends = pgTable(
  "meter_spends",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    spendMicrocredits: microcredits("spend_microcredits").notNull(),
    updatedAt: epochMs("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.meterId] }),
    check("meter_spends_nonnegative", sql`spend_microcredits >= 0`),
  ],
);

/**
 * Last activity per tenant+meter: the newest event timestamp seen, in µs.
 * The ingest Lua keeps a Redis key (mlast:) as the hot read via a GREATEST
 * max-update; this table is the durable copy it checkpoints to and rebuilds
 * from, so the inactive_for scheduler never has to derive recency from the
 * meter_events history (an unbounded scan) — staleness is an O(1) lookup.
 */
export const tenantLastActivity = pgTable(
  "tenant_last_activity",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.meterId),
    lastEventAtMicros: bigint("last_event_at_micros", {
      mode: "number",
    }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.meterId] })],
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
