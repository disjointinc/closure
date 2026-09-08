/**
 * v0/tenant/service.ts -- tenant business logic: tenant CRUD (soft delete)
 * and the entitlement check (features + meter balances resolved from the
 * current assignment, add-ons, and overrides).
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { getMeterBalance } from "../../cache/meter/index.ts";
import { db } from "../../db/index.ts";
import {
  addOnTypeFeatures,
  assignmentAddOns,
  assignments,
  featureOverrides,
  meterOverrides,
  planFeatures,
  planMeters,
  tenants,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { TenantCreateBody, TenantPatchBody } from "./routes.ts";

export async function getTenant({ tenantId }: { tenantId: string }) {
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.tenantId, tenantId));
  return row ?? null;
}

export async function listTenants() {
  return db.select().from(tenants);
}

export async function createTenant({ tenant }: { tenant: TenantCreateBody }) {
  const tenantId = generateId({ prefix: "tenant" });
  const createdAt = Date.now();
  await db
    .insert(tenants)
    .values({
      tenantId,
      createdAt,
      deletedAt: null,
      externalIds: tenant.externalIds,
    })
    .onConflictDoNothing();
  return { ...tenant, tenantId, createdAt, deletedAt: null };
}

/** Patch the tenant, or return null if no such tenant exists. */
export async function patchTenant({
  patch,
  tenantId,
}: {
  patch: TenantPatchBody;
  tenantId: string;
}) {
  const updated = await db
    .update(tenants)
    .set({ externalIds: patch.externalIds })
    .where(eq(tenants.tenantId, tenantId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return updated[0];
}

/** Soft-delete the tenant, or return null if no such tenant exists. */
export async function deleteTenant({ tenantId }: { tenantId: string }) {
  const updated = await db
    .update(tenants)
    .set({ deletedAt: Date.now() })
    .where(eq(tenants.tenantId, tenantId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return updated[0];
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
    .where(and(eq(assignments.tenantId, tenantId), isNull(assignments.endsAt)));
  if (!assignment) {
    return { tenantId, assignmentId: null, features: [], meters: [] };
  }

  const now = Date.now();

  const planFeatureRows = await db
    .select()
    .from(planFeatures)
    .where(eq(planFeatures.planId, assignment.planId));
  const assignmentAddOnRows = await db
    .select()
    .from(assignmentAddOns)
    .where(eq(assignmentAddOns.assignmentId, assignment.assignmentId));
  const activeAddOnTypeIds = assignmentAddOnRows
    .filter(
      (addOn) =>
        addOn.deletedAt === null &&
        addOn.startsAt <= now &&
        (addOn.endsAt === null || addOn.endsAt > now),
    )
    .map((addOn) => addOn.addOnTypeId);
  const addOnFeatureRows = (
    await Promise.all(
      activeAddOnTypeIds.map((addOnTypeId) =>
        db
          .select()
          .from(addOnTypeFeatures)
          .where(eq(addOnTypeFeatures.addOnTypeId, addOnTypeId)),
      ),
    )
  ).flat();
  const featureOverrideRows = await db
    .select()
    .from(featureOverrides)
    .where(eq(featureOverrides.tenantId, tenantId))
    .orderBy(desc(featureOverrides.createdAt));

  const featureMap = new Map<string, boolean | string[]>();
  for (const row of planFeatureRows) {
    featureMap.set(row.featureId, row.setTo);
  }
  for (const row of addOnFeatureRows) {
    featureMap.set(row.featureId, row.setTo);
  }
  const seenFeatures = new Set<string>();
  for (const row of featureOverrideRows) {
    if (!seenFeatures.has(row.featureId)) {
      seenFeatures.add(row.featureId);
      featureMap.set(row.featureId, row.setTo);
    }
  }

  const planMeterRows = await db
    .select()
    .from(planMeters)
    .where(eq(planMeters.planId, assignment.planId));
  const meterOverrideRows = await db
    .select()
    .from(meterOverrides)
    .where(eq(meterOverrides.tenantId, tenantId))
    .orderBy(desc(meterOverrides.createdAt));

  const meterMap = new Map<
    string,
    { defaultMicrocredits: number; limitMicrocredits: number | null }
  >();
  for (const row of planMeterRows) {
    meterMap.set(row.meterId, {
      defaultMicrocredits: row.defaultMicrocredits,
      limitMicrocredits: row.limitMicrocredits,
    });
  }
  const seenMeters = new Set<string>();
  for (const row of meterOverrideRows) {
    if (!seenMeters.has(row.meterId)) {
      seenMeters.add(row.meterId);
      meterMap.set(row.meterId, {
        defaultMicrocredits: row.defaultMicrocredits,
        limitMicrocredits: row.limitMicrocredits,
      });
    }
  }

  return {
    tenantId,
    assignmentId: assignment.assignmentId,
    features: [...featureMap.entries()].map(([featureId, setTo]) => ({
      featureId,
      setTo,
    })),
    meters: await Promise.all(
      [...meterMap.entries()].map(async ([meterId, config]) => ({
        meterId,
        defaultMicrocredits: config.defaultMicrocredits,
        limitMicrocredits: config.limitMicrocredits,
        balanceMicrocredits: await getMeterBalance({
          meterId,
          tenantId,
        }),
      })),
    ),
  };
}
