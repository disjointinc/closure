-- The rule backfill reads a tenant's credit grants on a meter in the order
-- they reached the balance, alongside the meter's events.
CREATE INDEX "credit_grants_tenant_meter_applied" ON "credit_grants" USING btree ("tenant_id","meter_id","applied_at_microseconds");