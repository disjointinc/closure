-- team_members
ALTER TABLE "team_members" RENAME COLUMN "id" TO "team_member_id";

-- values
ALTER TABLE "values" RENAME COLUMN "id" TO "value_id";

-- cycles
ALTER TABLE "cycles" RENAME COLUMN "id" TO "cycle_id";

-- tax_types
ALTER TABLE "tax_types" RENAME COLUMN "id" TO "tax_type_id";

-- taxes
ALTER TABLE "taxes" RENAME COLUMN "id" TO "tax_id";

-- features
ALTER TABLE "features" RENAME COLUMN "id" TO "feature_id";

-- feature_options
ALTER TABLE "feature_options" RENAME COLUMN "id" TO "feature_option_id";

-- meters
ALTER TABLE "meters" RENAME COLUMN "id" TO "meter_id";

-- plans
ALTER TABLE "plans" RENAME COLUMN "id" TO "plan_id";

-- add_ons
ALTER TABLE "add_ons" RENAME COLUMN "id" TO "add_on_id";

-- coupon_templates
ALTER TABLE "coupon_templates" RENAME COLUMN "id" TO "coupon_template_id";

-- coupons
ALTER TABLE "coupons" RENAME COLUMN "id" TO "coupon_id";

-- experiments
ALTER TABLE "experiments" RENAME COLUMN "id" TO "experiment_id";

-- tenants
ALTER TABLE "tenants" RENAME COLUMN "id" TO "tenant_id";

-- assignments
ALTER TABLE "assignments" RENAME COLUMN "id" TO "assignment_id";

-- invoices
ALTER TABLE "invoices" RENAME COLUMN "id" TO "invoice_id";

-- items
ALTER TABLE "items" RENAME COLUMN "id" TO "item_id";

-- taxation_amounts
ALTER TABLE "taxation_amounts" RENAME COLUMN "id" TO "taxation_amount_id";

-- payment_methods
ALTER TABLE "payment_methods" RENAME COLUMN "id" TO "payment_method_id";

-- payments
ALTER TABLE "payments" RENAME COLUMN "id" TO "payment_id";

-- refunds
ALTER TABLE "refunds" RENAME COLUMN "id" TO "refund_id";

-- feature_overrides
ALTER TABLE "feature_overrides" RENAME COLUMN "id" TO "feature_override_id";

-- meter_overrides
ALTER TABLE "meter_overrides" RENAME COLUMN "id" TO "meter_override_id";

-- credit_grants
ALTER TABLE "credit_grants" RENAME COLUMN "id" TO "credit_grant_id";

-- coupon_grants
ALTER TABLE "coupon_grants" RENAME COLUMN "id" TO "coupon_grant_id";

-- coupon_receipts
ALTER TABLE "coupon_receipts" RENAME COLUMN "id" TO "coupon_receipt_id";

-- meter_events
ALTER TABLE "meter_events" RENAME COLUMN "id" TO "meter_event_id";

-- meter_events_dlq
ALTER TABLE "meter_events_dlq" RENAME COLUMN "id" TO "meter_event_dlq_id";

-- the dlq identity sequence follows the renamed column
ALTER SEQUENCE "meter_events_dlq_id_seq" RENAME TO "meter_events_dlq_meter_event_dlq_id_seq";

-- constraint names follow the renamed referenced columns
ALTER TABLE "add_on_features" RENAME CONSTRAINT "add_on_features_add_on_id_add_ons_id_fk" TO "add_on_features_add_on_id_add_ons_add_on_id_fk";
ALTER TABLE "add_on_features" RENAME CONSTRAINT "add_on_features_feature_id_features_id_fk" TO "add_on_features_feature_id_features_feature_id_fk";
ALTER TABLE "add_on_prices" RENAME CONSTRAINT "add_on_prices_add_on_id_add_ons_id_fk" TO "add_on_prices_add_on_id_add_ons_add_on_id_fk";
ALTER TABLE "add_on_prices" RENAME CONSTRAINT "add_on_prices_cycle_id_cycles_id_fk" TO "add_on_prices_cycle_id_cycles_cycle_id_fk";
ALTER TABLE "add_on_prices" RENAME CONSTRAINT "add_on_prices_value_id_values_id_fk" TO "add_on_prices_value_id_values_value_id_fk";
ALTER TABLE "assignment_add_ons" RENAME CONSTRAINT "assignment_add_ons_add_on_id_add_ons_id_fk" TO "assignment_add_ons_add_on_id_add_ons_add_on_id_fk";
ALTER TABLE "assignment_add_ons" RENAME CONSTRAINT "assignment_add_ons_assignment_id_assignments_id_fk" TO "assignment_add_ons_assignment_id_assignments_assignment_id_fk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_cycle_id_cycles_id_fk" TO "assignments_cycle_id_cycles_cycle_id_fk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_experiment_id_experiments_id_fk" TO "assignments_experiment_id_experiments_experiment_id_fk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_plan_id_plans_id_fk" TO "assignments_plan_id_plans_plan_id_fk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_tenant_id_tenants_id_fk" TO "assignments_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "coupon_credits_granted" RENAME CONSTRAINT "coupon_credits_granted_coupon_id_coupons_id_fk" TO "coupon_credits_granted_coupon_id_coupons_coupon_id_fk";
ALTER TABLE "coupon_credits_granted" RENAME CONSTRAINT "coupon_credits_granted_meter_id_meters_id_fk" TO "coupon_credits_granted_meter_id_meters_meter_id_fk";
ALTER TABLE "coupon_features_granted" RENAME CONSTRAINT "coupon_features_granted_coupon_id_coupons_id_fk" TO "coupon_features_granted_coupon_id_coupons_coupon_id_fk";
ALTER TABLE "coupon_features_granted" RENAME CONSTRAINT "coupon_features_granted_feature_id_features_id_fk" TO "coupon_features_granted_feature_id_features_feature_id_fk";
ALTER TABLE "coupon_grants" RENAME CONSTRAINT "coupon_grants_coupon_id_coupons_id_fk" TO "coupon_grants_coupon_id_coupons_coupon_id_fk";
ALTER TABLE "coupon_grants" RENAME CONSTRAINT "coupon_grants_from_tenant_id_tenants_id_fk" TO "coupon_grants_from_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "coupon_grants" RENAME CONSTRAINT "coupon_grants_to_tenant_id_tenants_id_fk" TO "coupon_grants_to_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_by_coupon_grant_id_coupon_grants_id_fk" TO "coupon_receipts_by_coupon_grant_id_coupon_grants_coupon_grant_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_by_team_member_id_team_members_id_fk" TO "coupon_receipts_by_team_member_id_team_members_team_member_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_by_tenant_id_tenants_id_fk" TO "coupon_receipts_by_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_coupon_id_coupons_id_fk" TO "coupon_receipts_coupon_id_coupons_coupon_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_tenant_id_tenants_id_fk" TO "coupon_receipts_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "coupon_template_credits_granted" RENAME CONSTRAINT "coupon_template_credits_granted_meter_id_meters_id_fk" TO "coupon_template_credits_granted_meter_id_meters_meter_id_fk";
ALTER TABLE "coupon_template_features_granted" RENAME CONSTRAINT "coupon_template_features_granted_feature_id_features_id_fk" TO "coupon_template_features_granted_feature_id_features_feature_id_fk";
ALTER TABLE "coupons" RENAME CONSTRAINT "coupons_reciprocal_benefit_coupon_id_coupons_id_fk" TO "coupons_reciprocal_benefit_coupon_id_coupons_coupon_id_fk";
ALTER TABLE "coupons" RENAME CONSTRAINT "coupons_template_id_coupon_templates_id_fk" TO "coupons_template_id_coupon_templates_coupon_template_id_fk";
ALTER TABLE "credit_grants" RENAME CONSTRAINT "credit_grants_by_team_member_id_team_members_id_fk" TO "credit_grants_by_team_member_id_team_members_team_member_id_fk";
ALTER TABLE "credit_grants" RENAME CONSTRAINT "credit_grants_meter_id_meters_id_fk" TO "credit_grants_meter_id_meters_meter_id_fk";
ALTER TABLE "credit_grants" RENAME CONSTRAINT "credit_grants_tenant_id_tenants_id_fk" TO "credit_grants_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "experiment_treatment_tenants" RENAME CONSTRAINT "experiment_treatment_tenants_tenant_id_tenants_id_fk" TO "experiment_treatment_tenants_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "experiment_treatments" RENAME CONSTRAINT "experiment_treatments_experiment_id_experiments_id_fk" TO "experiment_treatments_experiment_id_experiments_experiment_id_fk";
ALTER TABLE "experiment_treatments" RENAME CONSTRAINT "experiment_treatments_plan_id_plans_id_fk" TO "experiment_treatments_plan_id_plans_plan_id_fk";
ALTER TABLE "experiments" RENAME CONSTRAINT "experiments_concluding_plan_id_plans_id_fk" TO "experiments_concluding_plan_id_plans_plan_id_fk";
ALTER TABLE "feature_options" RENAME CONSTRAINT "feature_options_feature_id_features_id_fk" TO "feature_options_feature_id_features_feature_id_fk";
ALTER TABLE "feature_overrides" RENAME CONSTRAINT "feature_overrides_by_team_member_id_team_members_id_fk" TO "feature_overrides_by_team_member_id_team_members_team_member_id_fk";
ALTER TABLE "feature_overrides" RENAME CONSTRAINT "feature_overrides_feature_id_features_id_fk" TO "feature_overrides_feature_id_features_feature_id_fk";
ALTER TABLE "feature_overrides" RENAME CONSTRAINT "feature_overrides_tenant_id_tenants_id_fk" TO "feature_overrides_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "feature_tax_types" RENAME CONSTRAINT "feature_tax_types_feature_id_features_id_fk" TO "feature_tax_types_feature_id_features_feature_id_fk";
ALTER TABLE "feature_tax_types" RENAME CONSTRAINT "feature_tax_types_tax_type_id_tax_types_id_fk" TO "feature_tax_types_tax_type_id_tax_types_tax_type_id_fk";
ALTER TABLE "invoices" RENAME CONSTRAINT "invoices_tenant_id_tenants_id_fk" TO "invoices_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "items" RENAME CONSTRAINT "items_invoice_id_invoices_id_fk" TO "items_invoice_id_invoices_invoice_id_fk";
ALTER TABLE "items" RENAME CONSTRAINT "items_per_unit_value_id_values_id_fk" TO "items_per_unit_value_id_values_value_id_fk";
ALTER TABLE "meter_balances" RENAME CONSTRAINT "meter_balances_meter_id_meters_id_fk" TO "meter_balances_meter_id_meters_meter_id_fk";
ALTER TABLE "meter_balances" RENAME CONSTRAINT "meter_balances_tenant_id_tenants_id_fk" TO "meter_balances_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "meter_events" RENAME CONSTRAINT "meter_events_meter_id_meters_id_fk" TO "meter_events_meter_id_meters_meter_id_fk";
ALTER TABLE "meter_events" RENAME CONSTRAINT "meter_events_tenant_id_tenants_id_fk" TO "meter_events_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "meter_overrides" RENAME CONSTRAINT "meter_overrides_by_team_member_id_team_members_id_fk" TO "meter_overrides_by_team_member_id_team_members_team_member_id_fk";
ALTER TABLE "meter_overrides" RENAME CONSTRAINT "meter_overrides_meter_id_meters_id_fk" TO "meter_overrides_meter_id_meters_meter_id_fk";
ALTER TABLE "meter_overrides" RENAME CONSTRAINT "meter_overrides_tenant_id_tenants_id_fk" TO "meter_overrides_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "meter_tax_types" RENAME CONSTRAINT "meter_tax_types_meter_id_meters_id_fk" TO "meter_tax_types_meter_id_meters_meter_id_fk";
ALTER TABLE "meter_tax_types" RENAME CONSTRAINT "meter_tax_types_tax_type_id_tax_types_id_fk" TO "meter_tax_types_tax_type_id_tax_types_tax_type_id_fk";
ALTER TABLE "payment_invoices" RENAME CONSTRAINT "payment_invoices_invoice_id_invoices_id_fk" TO "payment_invoices_invoice_id_invoices_invoice_id_fk";
ALTER TABLE "payment_invoices" RENAME CONSTRAINT "payment_invoices_payment_id_payments_id_fk" TO "payment_invoices_payment_id_payments_payment_id_fk";
ALTER TABLE "payment_methods" RENAME CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" TO "payment_methods_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "payments" RENAME CONSTRAINT "payments_tenant_id_tenants_id_fk" TO "payments_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "plan_add_ons" RENAME CONSTRAINT "plan_add_ons_add_on_id_add_ons_id_fk" TO "plan_add_ons_add_on_id_add_ons_add_on_id_fk";
ALTER TABLE "plan_add_ons" RENAME CONSTRAINT "plan_add_ons_plan_id_plans_id_fk" TO "plan_add_ons_plan_id_plans_plan_id_fk";
ALTER TABLE "plan_features" RENAME CONSTRAINT "plan_features_feature_id_features_id_fk" TO "plan_features_feature_id_features_feature_id_fk";
ALTER TABLE "plan_features" RENAME CONSTRAINT "plan_features_plan_id_plans_id_fk" TO "plan_features_plan_id_plans_plan_id_fk";
ALTER TABLE "plan_meters" RENAME CONSTRAINT "plan_meters_meter_id_meters_id_fk" TO "plan_meters_meter_id_meters_meter_id_fk";
ALTER TABLE "plan_meters" RENAME CONSTRAINT "plan_meters_plan_id_plans_id_fk" TO "plan_meters_plan_id_plans_plan_id_fk";
ALTER TABLE "plan_prices" RENAME CONSTRAINT "plan_prices_cycle_id_cycles_id_fk" TO "plan_prices_cycle_id_cycles_cycle_id_fk";
ALTER TABLE "plan_prices" RENAME CONSTRAINT "plan_prices_plan_id_plans_id_fk" TO "plan_prices_plan_id_plans_plan_id_fk";
ALTER TABLE "plan_prices" RENAME CONSTRAINT "plan_prices_value_id_values_id_fk" TO "plan_prices_value_id_values_value_id_fk";
ALTER TABLE "plans" RENAME CONSTRAINT "plans_derived_from_plan_id_plans_id_fk" TO "plans_derived_from_plan_id_plans_plan_id_fk";
ALTER TABLE "refunds" RENAME CONSTRAINT "refunds_by_team_member_id_team_members_id_fk" TO "refunds_by_team_member_id_team_members_team_member_id_fk";
ALTER TABLE "refunds" RENAME CONSTRAINT "refunds_tenant_id_tenants_id_fk" TO "refunds_tenant_id_tenants_tenant_id_fk";
ALTER TABLE "refunds" RENAME CONSTRAINT "refunds_value_id_values_id_fk" TO "refunds_value_id_values_value_id_fk";
ALTER TABLE "taxation_amount_items" RENAME CONSTRAINT "taxation_amount_items_item_id_items_id_fk" TO "taxation_amount_items_item_id_items_item_id_fk";
ALTER TABLE "taxation_amount_items" RENAME CONSTRAINT "taxation_amount_items_taxation_amount_id_taxation_amounts_id_fk" TO "taxation_amount_items_taxation_amount_id_taxation_amounts_taxation_amount_id_fk";
ALTER TABLE "taxation_amounts" RENAME CONSTRAINT "taxation_amounts_invoice_id_invoices_id_fk" TO "taxation_amounts_invoice_id_invoices_invoice_id_fk";
ALTER TABLE "taxation_amounts" RENAME CONSTRAINT "taxation_amounts_tax_id_taxes_id_fk" TO "taxation_amounts_tax_id_taxes_tax_id_fk";
ALTER TABLE "taxes" RENAME CONSTRAINT "taxes_tax_type_id_tax_types_id_fk" TO "taxes_tax_type_id_tax_types_tax_type_id_fk";
