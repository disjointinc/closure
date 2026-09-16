/**
 * v0/tenant/feature-entitlements/service.ts -- resolved feature entitlements:
 * every open assignment's plan features, plus active add-on features, with
 * the latest feature override per feature winning. A tenant may hold several
 * open assignments: plans merge in startsAt order, so where two plans set
 * the same feature the later assignment wins (the same latest-wins rule
 * overrides use).
 */
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import {
  addOnTypeFeatures,
  assignmentAddOns,
  assignments,
  featureOverrides,
  planFeatures,
} from "../../../db/schema.ts";

export async function getFeatureEntitlements({
  tenantId,
}: {
  tenantId: string;
}) {
  const openAssignments = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.tenantId, tenantId),
        isNull(assignments.endsAt),
        lte(assignments.startsAt, Date.now()),
      ),
    )
    .orderBy(assignments.startsAt);
  if (openAssignments.length === 0) {
    return [];
  }

  const now = Date.now();

  const planFeatureRows = (
    await Promise.all(
      openAssignments.map((assignment) =>
        db
          .select()
          .from(planFeatures)
          .where(eq(planFeatures.planId, assignment.planId)),
      ),
    )
  ).flat();
  const assignmentAddOnRows = (
    await Promise.all(
      openAssignments.map((assignment) =>
        db
          .select()
          .from(assignmentAddOns)
          .where(eq(assignmentAddOns.assignmentId, assignment.assignmentId)),
      ),
    )
  ).flat();
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

  return [...featureMap.entries()].map(([featureId, setTo]) => ({
    featureId,
    setTo,
  }));
}
