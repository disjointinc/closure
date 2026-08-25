/**
 * v0/tenants/service.ts -- tenant business logic: tenant CRUD (soft delete)
 * and the entitlement check (features + meter balances resolved from the
 * current assignment, add-ons, and overrides).
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { getMeterBalance } from "../../cache/metering.ts";
import { db } from "../../db/index.ts";
import {
  addOnFeatures,
  assignmentAddOns,
  assignments,
  featureOverrides,
  meterOverrides,
  planFeatures,
  planMeters,
  tenants,
} from "../../db/schema.ts";
import type { TenantCreateBody, TenantPatchBody } from "./routes.ts";

function rowToTenant(row: typeof tenants.$inferSelect) {
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
    external_ids: row.externalIds,
  };
}

export async function getTenant({ uniqueId }: { uniqueId: string }) {
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  return rowToTenant(row);
}

export async function listTenants() {
  const rows = await db.select().from(tenants);
  return rows.map(rowToTenant);
}

export async function createTenant({ tenant }: { tenant: TenantCreateBody }) {
  await db
    .insert(tenants)
    .values({
      uniqueId: tenant.unique_id,
      createdAt: tenant.created_at,
      deletedAt: null,
      externalIds: tenant.external_ids,
    })
    .onConflictDoNothing();
  return { ...tenant, deleted_at: null };
}

/** Patch the tenant, or return null if no such tenant exists. */
export async function patchTenant({
  patch,
  uniqueId,
}: {
  patch: TenantPatchBody;
  uniqueId: string;
}) {
  const updated = await db
    .update(tenants)
    .set({ externalIds: patch.external_ids })
    .where(eq(tenants.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToTenant(updated[0]);
}

/** Soft-delete the tenant, or return null if no such tenant exists. */
export async function deleteTenant({ uniqueId }: { uniqueId: string }) {
  const updated = await db
    .update(tenants)
    .set({ deletedAt: Date.now() })
    .where(eq(tenants.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToTenant(updated[0]);
}

/**
 * Resolve what a tenant can do right now: the open assignment's plan
 * features, plus active add-on features, with the latest feature override
 * per feature winning; plan meters with the latest meter override per
 * meter, each with its live Redis balance.
 */
export async function getEntitlements({ tenantId }: { tenantId: string }) {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.tenant, tenantId), isNull(assignments.end)))
    .orderBy(desc(assignments.start))
    .limit(1);
  if (!assignment) {
    return { tenant: tenantId, assignment: null, features: [], meters: [] };
  }

  const now = Date.now();

  const planFeatureRows = await db
    .select()
    .from(planFeatures)
    .where(eq(planFeatures.plan, assignment.plan));
  const assignmentAddOnRows = await db
    .select()
    .from(assignmentAddOns)
    .where(eq(assignmentAddOns.assignment, assignment.uniqueId));
  const activeAddOnIds = assignmentAddOnRows
    .filter(
      (addOn) => addOn.start <= now && (addOn.end === null || addOn.end > now),
    )
    .map((addOn) => addOn.addOn);
  const addOnFeatureRows = (
    await Promise.all(
      activeAddOnIds.map((addOn) =>
        db.select().from(addOnFeatures).where(eq(addOnFeatures.addOn, addOn)),
      ),
    )
  ).flat();
  const featureOverrideRows = await db
    .select()
    .from(featureOverrides)
    .where(eq(featureOverrides.tenant, tenantId))
    .orderBy(desc(featureOverrides.on));

  const featureMap = new Map<string, boolean | string[]>();
  for (const row of planFeatureRows) {
    featureMap.set(row.feature, row.setTo);
  }
  for (const row of addOnFeatureRows) {
    featureMap.set(row.feature, row.setTo);
  }
  const seenFeatures = new Set<string>();
  for (const row of featureOverrideRows) {
    if (!seenFeatures.has(row.feature)) {
      seenFeatures.add(row.feature);
      featureMap.set(row.feature, row.setTo);
    }
  }

  const planMeterRows = await db
    .select()
    .from(planMeters)
    .where(eq(planMeters.plan, assignment.plan));
  const meterOverrideRows = await db
    .select()
    .from(meterOverrides)
    .where(eq(meterOverrides.tenant, tenantId))
    .orderBy(desc(meterOverrides.on));

  const meterMap = new Map<string, { default: number; limit: number | null }>();
  for (const row of planMeterRows) {
    meterMap.set(row.meter, {
      default: row.defaultMicrocredits,
      limit: row.limitMicrocredits,
    });
  }
  const seenMeters = new Set<string>();
  for (const row of meterOverrideRows) {
    if (!seenMeters.has(row.meter)) {
      seenMeters.add(row.meter);
      meterMap.set(row.meter, {
        default: row.defaultMicrocredits,
        limit: row.limitMicrocredits,
      });
    }
  }

  return {
    tenant: tenantId,
    assignment: assignment.uniqueId,
    features: [...featureMap.entries()].map(([feature, set_to]) => ({
      feature,
      set_to,
    })),
    meters: await Promise.all(
      [...meterMap.entries()].map(async ([meter, config]) => ({
        meter,
        default_microcredits: config.default,
        limit_microcredits: config.limit,
        balance_microcredits: await getMeterBalance({
          meterId: meter,
          tenantId,
        }),
      })),
    ),
  };
}
