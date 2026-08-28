-- team_members
ALTER TABLE "team_members" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "team_members" RENAME COLUMN "email_address" TO "email";
ALTER TABLE "team_members" RENAME COLUMN "profile_picture_link" TO "profile_picture_url";

-- values
ALTER TABLE "values" RENAME COLUMN "unique_id" TO "id";

-- cycles
ALTER TABLE "cycles" RENAME COLUMN "unique_id" TO "id";

-- tax_types
ALTER TABLE "tax_types" RENAME COLUMN "unique_id" TO "id";

-- taxes
ALTER TABLE "taxes" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "taxes" RENAME COLUMN "tax_type" TO "tax_type_id";

-- features
ALTER TABLE "features" RENAME COLUMN "unique_id" TO "id";

-- feature_options
ALTER TABLE "feature_options" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "feature_options" RENAME COLUMN "feature" TO "feature_id";

-- feature_tax_types
ALTER TABLE "feature_tax_types" RENAME COLUMN "feature" TO "feature_id";
ALTER TABLE "feature_tax_types" RENAME COLUMN "tax_type" TO "tax_type_id";

-- meters
ALTER TABLE "meters" RENAME COLUMN "unique_id" TO "id";

-- meter_tax_types
ALTER TABLE "meter_tax_types" RENAME COLUMN "meter" TO "meter_id";
ALTER TABLE "meter_tax_types" RENAME COLUMN "tax_type" TO "tax_type_id";

-- plans
ALTER TABLE "plans" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "plans" RENAME COLUMN "derived_from" TO "derived_from_plan_id";

-- plan_prices
ALTER TABLE "plan_prices" RENAME COLUMN "plan" TO "plan_id";
ALTER TABLE "plan_prices" RENAME COLUMN "cycle" TO "cycle_id";
ALTER TABLE "plan_prices" RENAME COLUMN "value" TO "value_id";

-- plan_features
ALTER TABLE "plan_features" RENAME COLUMN "plan" TO "plan_id";
ALTER TABLE "plan_features" RENAME COLUMN "feature" TO "feature_id";

-- plan_meters
ALTER TABLE "plan_meters" RENAME COLUMN "plan" TO "plan_id";
ALTER TABLE "plan_meters" RENAME COLUMN "meter" TO "meter_id";

-- plan_add_ons
ALTER TABLE "plan_add_ons" RENAME COLUMN "plan" TO "plan_id";
ALTER TABLE "plan_add_ons" RENAME COLUMN "add_on" TO "add_on_id";

-- add_ons
ALTER TABLE "add_ons" RENAME COLUMN "unique_id" TO "id";

-- add_on_prices
ALTER TABLE "add_on_prices" RENAME COLUMN "add_on" TO "add_on_id";
ALTER TABLE "add_on_prices" RENAME COLUMN "cycle" TO "cycle_id";
ALTER TABLE "add_on_prices" RENAME COLUMN "value" TO "value_id";

-- add_on_features
ALTER TABLE "add_on_features" RENAME COLUMN "add_on" TO "add_on_id";
ALTER TABLE "add_on_features" RENAME COLUMN "feature" TO "feature_id";

-- coupon_templates
ALTER TABLE "coupon_templates" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "coupon_templates" RENAME COLUMN "reciprocal_benefit_coupon_template" TO "reciprocal_benefit_coupon_template_id";

-- coupon_template_features_granted
ALTER TABLE "coupon_template_features_granted" RENAME COLUMN "coupon_template" TO "coupon_template_id";
ALTER TABLE "coupon_template_features_granted" RENAME COLUMN "feature" TO "feature_id";
ALTER TABLE "coupon_template_features_granted" RENAME COLUMN "value" TO "set_to";

-- coupon_template_credits_granted
ALTER TABLE "coupon_template_credits_granted" RENAME COLUMN "coupon_template" TO "coupon_template_id";
ALTER TABLE "coupon_template_credits_granted" RENAME COLUMN "meter" TO "meter_id";

-- coupons
ALTER TABLE "coupons" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "coupons" RENAME COLUMN "template" TO "template_id";
ALTER TABLE "coupons" RENAME COLUMN "reciprocal_benefit_coupon" TO "reciprocal_benefit_coupon_id";

-- coupon_features_granted
ALTER TABLE "coupon_features_granted" RENAME COLUMN "coupon" TO "coupon_id";
ALTER TABLE "coupon_features_granted" RENAME COLUMN "feature" TO "feature_id";
ALTER TABLE "coupon_features_granted" RENAME COLUMN "value" TO "set_to";

-- coupon_credits_granted
ALTER TABLE "coupon_credits_granted" RENAME COLUMN "coupon" TO "coupon_id";
ALTER TABLE "coupon_credits_granted" RENAME COLUMN "meter" TO "meter_id";

-- experiments
ALTER TABLE "experiments" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "experiments" RENAME COLUMN "plan_assignment_at_conclusion" TO "concluding_plan_id";

-- experiment_treatments
ALTER TABLE "experiment_treatments" RENAME COLUMN "experiment" TO "experiment_id";
ALTER TABLE "experiment_treatments" RENAME COLUMN "plan" TO "plan_id";

-- experiment_treatment_tenants
ALTER TABLE "experiment_treatment_tenants" RENAME COLUMN "experiment" TO "experiment_id";
ALTER TABLE "experiment_treatment_tenants" RENAME COLUMN "plan" TO "plan_id";
ALTER TABLE "experiment_treatment_tenants" RENAME COLUMN "tenant" TO "tenant_id";

-- tenants
ALTER TABLE "tenants" RENAME COLUMN "unique_id" TO "id";

-- assignments
ALTER TABLE "assignments" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "assignments" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "assignments" RENAME COLUMN "plan" TO "plan_id";
ALTER TABLE "assignments" RENAME COLUMN "experiment" TO "experiment_id";
ALTER TABLE "assignments" RENAME COLUMN "cycle" TO "cycle_id";
ALTER TABLE "assignments" RENAME COLUMN "start" TO "starts_at";
ALTER TABLE "assignments" RENAME COLUMN "end" TO "ends_at";

-- assignment_add_ons
ALTER TABLE "assignment_add_ons" RENAME COLUMN "assignment" TO "assignment_id";
ALTER TABLE "assignment_add_ons" RENAME COLUMN "add_on" TO "add_on_id";
ALTER TABLE "assignment_add_ons" RENAME COLUMN "start" TO "starts_at";
ALTER TABLE "assignment_add_ons" RENAME COLUMN "end" TO "ends_at";

-- invoices
ALTER TABLE "invoices" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "invoices" RENAME COLUMN "tenant" TO "tenant_id";

-- items
ALTER TABLE "items" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "items" RENAME COLUMN "invoice" TO "invoice_id";
ALTER TABLE "items" RENAME COLUMN "per_unit_value" TO "per_unit_value_id";

-- taxation_amounts
ALTER TABLE "taxation_amounts" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "taxation_amounts" RENAME COLUMN "invoice" TO "invoice_id";
ALTER TABLE "taxation_amounts" RENAME COLUMN "tax" TO "tax_id";
ALTER TABLE "taxation_amounts" RENAME COLUMN "notes" TO "description";

-- taxation_amount_items
ALTER TABLE "taxation_amount_items" RENAME COLUMN "taxation_amount" TO "taxation_amount_id";
ALTER TABLE "taxation_amount_items" RENAME COLUMN "item" TO "item_id";

-- payment_methods
ALTER TABLE "payment_methods" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "payment_methods" RENAME COLUMN "tenant" TO "tenant_id";

-- payments
ALTER TABLE "payments" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "payments" RENAME COLUMN "tenant" TO "tenant_id";

-- payment_invoices
ALTER TABLE "payment_invoices" RENAME COLUMN "payment" TO "payment_id";
ALTER TABLE "payment_invoices" RENAME COLUMN "invoice" TO "invoice_id";

-- refunds
ALTER TABLE "refunds" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "refunds" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "refunds" RENAME COLUMN "by_team_member" TO "by_team_member_id";
ALTER TABLE "refunds" RENAME COLUMN "value" TO "value_id";

-- feature_overrides
ALTER TABLE "feature_overrides" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "feature_overrides" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "feature_overrides" RENAME COLUMN "feature" TO "feature_id";
ALTER TABLE "feature_overrides" RENAME COLUMN "on" TO "created_at";
ALTER TABLE "feature_overrides" RENAME COLUMN "by_team_member" TO "by_team_member_id";

-- meter_overrides
ALTER TABLE "meter_overrides" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "meter_overrides" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "meter_overrides" RENAME COLUMN "meter" TO "meter_id";
ALTER TABLE "meter_overrides" RENAME COLUMN "on" TO "created_at";
ALTER TABLE "meter_overrides" RENAME COLUMN "by_team_member" TO "by_team_member_id";

-- credit_grants
ALTER TABLE "credit_grants" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "credit_grants" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "credit_grants" RENAME COLUMN "meter" TO "meter_id";
ALTER TABLE "credit_grants" RENAME COLUMN "on" TO "granted_at";
ALTER TABLE "credit_grants" RENAME COLUMN "by_team_member" TO "by_team_member_id";
ALTER TABLE "credit_grants" RENAME COLUMN "applied_at" TO "applied_at_micros";

-- coupon_grants
ALTER TABLE "coupon_grants" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "coupon_grants" RENAME COLUMN "tenant" TO "from_tenant_id";
ALTER TABLE "coupon_grants" RENAME COLUMN "coupon" TO "coupon_id";
ALTER TABLE "coupon_grants" RENAME COLUMN "on" TO "granted_at";
ALTER TABLE "coupon_grants" RENAME COLUMN "to_tenant" TO "to_tenant_id";

-- coupon_receipts
ALTER TABLE "coupon_receipts" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "coupon_receipts" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "coupon_receipts" RENAME COLUMN "coupon" TO "coupon_id";
ALTER TABLE "coupon_receipts" RENAME COLUMN "on" TO "received_at";
ALTER TABLE "coupon_receipts" RENAME COLUMN "by_team_member" TO "by_team_member_id";
ALTER TABLE "coupon_receipts" RENAME COLUMN "by_tenant" TO "by_tenant_id";
ALTER TABLE "coupon_receipts" RENAME COLUMN "by_coupon_grant" TO "by_coupon_grant_id";

-- meter_events
ALTER TABLE "meter_events" RENAME COLUMN "unique_id" TO "id";
ALTER TABLE "meter_events" RENAME COLUMN "unique_external_id" TO "external_id";
ALTER TABLE "meter_events" RENAME COLUMN "received_at" TO "received_at_micros";
ALTER TABLE "meter_events" RENAME COLUMN "meter" TO "meter_id";
ALTER TABLE "meter_events" RENAME COLUMN "tenant" TO "tenant_id";

-- meter_balances
ALTER TABLE "meter_balances" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "meter_balances" RENAME COLUMN "meter" TO "meter_id";

-- meter_events_dlq
ALTER TABLE "meter_events_dlq" RENAME COLUMN "tenant" TO "tenant_id";
ALTER TABLE "meter_events_dlq" RENAME COLUMN "meter" TO "meter_id";
ALTER TABLE "meter_events_dlq" RENAME COLUMN "received_at" TO "received_at_micros";

-- constraint names follow the renamed columns
ALTER TABLE "add_on_features" RENAME CONSTRAINT "add_on_features_add_on_add_ons_unique_id_fk" TO "add_on_features_add_on_id_add_ons_id_fk";
ALTER TABLE "add_on_features" RENAME CONSTRAINT "add_on_features_feature_features_unique_id_fk" TO "add_on_features_feature_id_features_id_fk";
ALTER TABLE "add_on_features" RENAME CONSTRAINT "add_on_features_add_on_feature_pk" TO "add_on_features_add_on_id_feature_id_pk";
ALTER TABLE "add_on_prices" RENAME CONSTRAINT "add_on_prices_add_on_add_ons_unique_id_fk" TO "add_on_prices_add_on_id_add_ons_id_fk";
ALTER TABLE "add_on_prices" RENAME CONSTRAINT "add_on_prices_cycle_cycles_unique_id_fk" TO "add_on_prices_cycle_id_cycles_id_fk";
ALTER TABLE "add_on_prices" RENAME CONSTRAINT "add_on_prices_value_values_unique_id_fk" TO "add_on_prices_value_id_values_id_fk";
ALTER TABLE "add_on_prices" RENAME CONSTRAINT "add_on_prices_add_on_cycle_pk" TO "add_on_prices_add_on_id_cycle_id_pk";
ALTER TABLE "assignment_add_ons" RENAME CONSTRAINT "assignment_add_ons_assignment_assignments_unique_id_fk" TO "assignment_add_ons_assignment_id_assignments_id_fk";
ALTER TABLE "assignment_add_ons" RENAME CONSTRAINT "assignment_add_ons_add_on_add_ons_unique_id_fk" TO "assignment_add_ons_add_on_id_add_ons_id_fk";
ALTER TABLE "assignment_add_ons" RENAME CONSTRAINT "assignment_add_ons_assignment_add_on_start_pk" TO "assignment_add_ons_assignment_id_add_on_id_starts_at_pk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_tenant_tenants_unique_id_fk" TO "assignments_tenant_id_tenants_id_fk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_plan_plans_unique_id_fk" TO "assignments_plan_id_plans_id_fk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_experiment_experiments_unique_id_fk" TO "assignments_experiment_id_experiments_id_fk";
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_cycle_cycles_unique_id_fk" TO "assignments_cycle_id_cycles_id_fk";
ALTER TABLE "coupon_credits_granted" RENAME CONSTRAINT "coupon_credits_granted_coupon_coupons_unique_id_fk" TO "coupon_credits_granted_coupon_id_coupons_id_fk";
ALTER TABLE "coupon_credits_granted" RENAME CONSTRAINT "coupon_credits_granted_meter_meters_unique_id_fk" TO "coupon_credits_granted_meter_id_meters_id_fk";
ALTER TABLE "coupon_credits_granted" RENAME CONSTRAINT "coupon_credits_granted_coupon_meter_pk" TO "coupon_credits_granted_coupon_id_meter_id_pk";
ALTER TABLE "coupon_features_granted" RENAME CONSTRAINT "coupon_features_granted_coupon_coupons_unique_id_fk" TO "coupon_features_granted_coupon_id_coupons_id_fk";
ALTER TABLE "coupon_features_granted" RENAME CONSTRAINT "coupon_features_granted_feature_features_unique_id_fk" TO "coupon_features_granted_feature_id_features_id_fk";
ALTER TABLE "coupon_features_granted" RENAME CONSTRAINT "coupon_features_granted_coupon_feature_pk" TO "coupon_features_granted_coupon_id_feature_id_pk";
ALTER TABLE "coupon_grants" RENAME CONSTRAINT "coupon_grants_tenant_tenants_unique_id_fk" TO "coupon_grants_from_tenant_id_tenants_id_fk";
ALTER TABLE "coupon_grants" RENAME CONSTRAINT "coupon_grants_coupon_coupons_unique_id_fk" TO "coupon_grants_coupon_id_coupons_id_fk";
ALTER TABLE "coupon_grants" RENAME CONSTRAINT "coupon_grants_to_tenant_tenants_unique_id_fk" TO "coupon_grants_to_tenant_id_tenants_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_tenant_tenants_unique_id_fk" TO "coupon_receipts_tenant_id_tenants_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_coupon_coupons_unique_id_fk" TO "coupon_receipts_coupon_id_coupons_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_by_team_member_team_members_unique_id_fk" TO "coupon_receipts_by_team_member_id_team_members_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_by_tenant_tenants_unique_id_fk" TO "coupon_receipts_by_tenant_id_tenants_id_fk";
ALTER TABLE "coupon_receipts" RENAME CONSTRAINT "coupon_receipts_by_coupon_grant_coupon_grants_unique_id_fk" TO "coupon_receipts_by_coupon_grant_id_coupon_grants_id_fk";
ALTER TABLE "coupon_template_credits_granted" RENAME CONSTRAINT "coupon_template_credits_granted_coupon_template_coupon_template" TO "coupon_template_credits_granted_coupon_template_id_coupon_templ";
ALTER TABLE "coupon_template_credits_granted" RENAME CONSTRAINT "coupon_template_credits_granted_meter_meters_unique_id_fk" TO "coupon_template_credits_granted_meter_id_meters_id_fk";
ALTER TABLE "coupon_template_credits_granted" RENAME CONSTRAINT "coupon_template_credits_granted_coupon_template_meter_pk" TO "coupon_template_credits_granted_coupon_template_id_meter_id_pk";
ALTER TABLE "coupon_template_features_granted" RENAME CONSTRAINT "coupon_template_features_granted_coupon_template_coupon_templat" TO "coupon_template_features_granted_coupon_template_id_coupon_temp";
ALTER TABLE "coupon_template_features_granted" RENAME CONSTRAINT "coupon_template_features_granted_feature_features_unique_id_fk" TO "coupon_template_features_granted_feature_id_features_id_fk";
ALTER TABLE "coupon_template_features_granted" RENAME CONSTRAINT "coupon_template_features_granted_coupon_template_feature_pk" TO "coupon_template_features_granted_coupon_template_id_feature_id_";
ALTER TABLE "coupon_templates" RENAME CONSTRAINT "coupon_templates_reciprocal_benefit_coupon_template_coupon_temp" TO "coupon_templates_reciprocal_benefit_coupon_template_id_coupon_t";
ALTER TABLE "coupons" RENAME CONSTRAINT "coupons_template_coupon_templates_unique_id_fk" TO "coupons_template_id_coupon_templates_id_fk";
ALTER TABLE "coupons" RENAME CONSTRAINT "coupons_reciprocal_benefit_coupon_coupons_unique_id_fk" TO "coupons_reciprocal_benefit_coupon_id_coupons_id_fk";
ALTER TABLE "credit_grants" RENAME CONSTRAINT "credit_grants_tenant_tenants_unique_id_fk" TO "credit_grants_tenant_id_tenants_id_fk";
ALTER TABLE "credit_grants" RENAME CONSTRAINT "credit_grants_meter_meters_unique_id_fk" TO "credit_grants_meter_id_meters_id_fk";
ALTER TABLE "credit_grants" RENAME CONSTRAINT "credit_grants_by_team_member_team_members_unique_id_fk" TO "credit_grants_by_team_member_id_team_members_id_fk";
ALTER TABLE "experiment_treatment_tenants" RENAME CONSTRAINT "experiment_treatment_tenants_tenant_tenants_unique_id_fk" TO "experiment_treatment_tenants_tenant_id_tenants_id_fk";
ALTER TABLE "experiment_treatment_tenants" RENAME CONSTRAINT "experiment_treatment_tenants_experiment_plan_experiment_treatme" TO "experiment_treatment_tenants_experiment_id_plan_id_experiment_t";
ALTER TABLE "experiment_treatment_tenants" RENAME CONSTRAINT "experiment_treatment_tenants_experiment_tenant_pk" TO "experiment_treatment_tenants_experiment_id_tenant_id_pk";
ALTER TABLE "experiment_treatments" RENAME CONSTRAINT "experiment_treatments_experiment_experiments_unique_id_fk" TO "experiment_treatments_experiment_id_experiments_id_fk";
ALTER TABLE "experiment_treatments" RENAME CONSTRAINT "experiment_treatments_plan_plans_unique_id_fk" TO "experiment_treatments_plan_id_plans_id_fk";
ALTER TABLE "experiment_treatments" RENAME CONSTRAINT "experiment_treatments_experiment_plan_pk" TO "experiment_treatments_experiment_id_plan_id_pk";
ALTER TABLE "experiments" RENAME CONSTRAINT "experiments_plan_assignment_at_conclusion_plans_unique_id_fk" TO "experiments_concluding_plan_id_plans_id_fk";
ALTER TABLE "feature_options" RENAME CONSTRAINT "feature_options_feature_features_unique_id_fk" TO "feature_options_feature_id_features_id_fk";
ALTER TABLE "feature_overrides" RENAME CONSTRAINT "feature_overrides_tenant_tenants_unique_id_fk" TO "feature_overrides_tenant_id_tenants_id_fk";
ALTER TABLE "feature_overrides" RENAME CONSTRAINT "feature_overrides_feature_features_unique_id_fk" TO "feature_overrides_feature_id_features_id_fk";
ALTER TABLE "feature_overrides" RENAME CONSTRAINT "feature_overrides_by_team_member_team_members_unique_id_fk" TO "feature_overrides_by_team_member_id_team_members_id_fk";
ALTER TABLE "feature_tax_types" RENAME CONSTRAINT "feature_tax_types_feature_features_unique_id_fk" TO "feature_tax_types_feature_id_features_id_fk";
ALTER TABLE "feature_tax_types" RENAME CONSTRAINT "feature_tax_types_tax_type_tax_types_unique_id_fk" TO "feature_tax_types_tax_type_id_tax_types_id_fk";
ALTER TABLE "feature_tax_types" RENAME CONSTRAINT "feature_tax_types_feature_tax_type_pk" TO "feature_tax_types_feature_id_tax_type_id_pk";
ALTER TABLE "invoices" RENAME CONSTRAINT "invoices_tenant_tenants_unique_id_fk" TO "invoices_tenant_id_tenants_id_fk";
ALTER TABLE "items" RENAME CONSTRAINT "items_invoice_invoices_unique_id_fk" TO "items_invoice_id_invoices_id_fk";
ALTER TABLE "items" RENAME CONSTRAINT "items_per_unit_value_values_unique_id_fk" TO "items_per_unit_value_id_values_id_fk";
ALTER TABLE "meter_balances" RENAME CONSTRAINT "meter_balances_tenant_tenants_unique_id_fk" TO "meter_balances_tenant_id_tenants_id_fk";
ALTER TABLE "meter_balances" RENAME CONSTRAINT "meter_balances_meter_meters_unique_id_fk" TO "meter_balances_meter_id_meters_id_fk";
ALTER TABLE "meter_balances" RENAME CONSTRAINT "meter_balances_tenant_meter_pk" TO "meter_balances_tenant_id_meter_id_pk";
ALTER TABLE "meter_events" RENAME CONSTRAINT "meter_events_meter_meters_unique_id_fk" TO "meter_events_meter_id_meters_id_fk";
ALTER TABLE "meter_events" RENAME CONSTRAINT "meter_events_tenant_tenants_unique_id_fk" TO "meter_events_tenant_id_tenants_id_fk";
ALTER TABLE "meter_overrides" RENAME CONSTRAINT "meter_overrides_tenant_tenants_unique_id_fk" TO "meter_overrides_tenant_id_tenants_id_fk";
ALTER TABLE "meter_overrides" RENAME CONSTRAINT "meter_overrides_meter_meters_unique_id_fk" TO "meter_overrides_meter_id_meters_id_fk";
ALTER TABLE "meter_overrides" RENAME CONSTRAINT "meter_overrides_by_team_member_team_members_unique_id_fk" TO "meter_overrides_by_team_member_id_team_members_id_fk";
ALTER TABLE "meter_tax_types" RENAME CONSTRAINT "meter_tax_types_meter_meters_unique_id_fk" TO "meter_tax_types_meter_id_meters_id_fk";
ALTER TABLE "meter_tax_types" RENAME CONSTRAINT "meter_tax_types_tax_type_tax_types_unique_id_fk" TO "meter_tax_types_tax_type_id_tax_types_id_fk";
ALTER TABLE "meter_tax_types" RENAME CONSTRAINT "meter_tax_types_meter_tax_type_pk" TO "meter_tax_types_meter_id_tax_type_id_pk";
ALTER TABLE "payment_invoices" RENAME CONSTRAINT "payment_invoices_payment_payments_unique_id_fk" TO "payment_invoices_payment_id_payments_id_fk";
ALTER TABLE "payment_invoices" RENAME CONSTRAINT "payment_invoices_invoice_invoices_unique_id_fk" TO "payment_invoices_invoice_id_invoices_id_fk";
ALTER TABLE "payment_invoices" RENAME CONSTRAINT "payment_invoices_payment_invoice_pk" TO "payment_invoices_payment_id_invoice_id_pk";
ALTER TABLE "payment_methods" RENAME CONSTRAINT "payment_methods_tenant_tenants_unique_id_fk" TO "payment_methods_tenant_id_tenants_id_fk";
ALTER TABLE "payments" RENAME CONSTRAINT "payments_tenant_tenants_unique_id_fk" TO "payments_tenant_id_tenants_id_fk";
ALTER TABLE "plan_add_ons" RENAME CONSTRAINT "plan_add_ons_plan_plans_unique_id_fk" TO "plan_add_ons_plan_id_plans_id_fk";
ALTER TABLE "plan_add_ons" RENAME CONSTRAINT "plan_add_ons_add_on_add_ons_unique_id_fk" TO "plan_add_ons_add_on_id_add_ons_id_fk";
ALTER TABLE "plan_add_ons" RENAME CONSTRAINT "plan_add_ons_plan_add_on_pk" TO "plan_add_ons_plan_id_add_on_id_pk";
ALTER TABLE "plan_features" RENAME CONSTRAINT "plan_features_plan_plans_unique_id_fk" TO "plan_features_plan_id_plans_id_fk";
ALTER TABLE "plan_features" RENAME CONSTRAINT "plan_features_feature_features_unique_id_fk" TO "plan_features_feature_id_features_id_fk";
ALTER TABLE "plan_features" RENAME CONSTRAINT "plan_features_plan_feature_pk" TO "plan_features_plan_id_feature_id_pk";
ALTER TABLE "plan_meters" RENAME CONSTRAINT "plan_meters_plan_plans_unique_id_fk" TO "plan_meters_plan_id_plans_id_fk";
ALTER TABLE "plan_meters" RENAME CONSTRAINT "plan_meters_meter_meters_unique_id_fk" TO "plan_meters_meter_id_meters_id_fk";
ALTER TABLE "plan_meters" RENAME CONSTRAINT "plan_meters_plan_meter_pk" TO "plan_meters_plan_id_meter_id_pk";
ALTER TABLE "plan_prices" RENAME CONSTRAINT "plan_prices_plan_plans_unique_id_fk" TO "plan_prices_plan_id_plans_id_fk";
ALTER TABLE "plan_prices" RENAME CONSTRAINT "plan_prices_cycle_cycles_unique_id_fk" TO "plan_prices_cycle_id_cycles_id_fk";
ALTER TABLE "plan_prices" RENAME CONSTRAINT "plan_prices_value_values_unique_id_fk" TO "plan_prices_value_id_values_id_fk";
ALTER TABLE "plan_prices" RENAME CONSTRAINT "plan_prices_plan_cycle_pk" TO "plan_prices_plan_id_cycle_id_pk";
ALTER TABLE "plans" RENAME CONSTRAINT "plans_derived_from_plans_unique_id_fk" TO "plans_derived_from_plan_id_plans_id_fk";
ALTER TABLE "refunds" RENAME CONSTRAINT "refunds_tenant_tenants_unique_id_fk" TO "refunds_tenant_id_tenants_id_fk";
ALTER TABLE "refunds" RENAME CONSTRAINT "refunds_by_team_member_team_members_unique_id_fk" TO "refunds_by_team_member_id_team_members_id_fk";
ALTER TABLE "refunds" RENAME CONSTRAINT "refunds_value_values_unique_id_fk" TO "refunds_value_id_values_id_fk";
ALTER TABLE "taxation_amount_items" RENAME CONSTRAINT "taxation_amount_items_taxation_amount_taxation_amounts_unique_i" TO "taxation_amount_items_taxation_amount_id_taxation_amounts_id_fk";
ALTER TABLE "taxation_amount_items" RENAME CONSTRAINT "taxation_amount_items_item_items_unique_id_fk" TO "taxation_amount_items_item_id_items_id_fk";
ALTER TABLE "taxation_amount_items" RENAME CONSTRAINT "taxation_amount_items_taxation_amount_item_pk" TO "taxation_amount_items_taxation_amount_id_item_id_pk";
ALTER TABLE "taxation_amounts" RENAME CONSTRAINT "taxation_amounts_invoice_invoices_unique_id_fk" TO "taxation_amounts_invoice_id_invoices_id_fk";
ALTER TABLE "taxation_amounts" RENAME CONSTRAINT "taxation_amounts_tax_taxes_unique_id_fk" TO "taxation_amounts_tax_id_taxes_id_fk";
ALTER TABLE "taxes" RENAME CONSTRAINT "taxes_tax_type_tax_types_unique_id_fk" TO "taxes_tax_type_id_tax_types_id_fk";
ALTER TABLE "team_members" RENAME CONSTRAINT "team_members_email_address_unique" TO "team_members_email_unique";
