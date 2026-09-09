/**
 * v0/product-line/service.ts -- product line business logic. Immutable, so
 * deletes deprecate.
 *
 * Split and consolidate are the line lifecycle operations. Both preserve
 * assignment startsAt/cycleId verbatim, so cycle-anchored rule windows and
 * quotas compute identical boundaries across the operation.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  addOnTypeFeatures,
  addOnTypes,
  assignments,
  features,
  meters,
  planAddOnTypes,
  planFeatures,
  planMeters,
  plans,
  productLines,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { ProductLine } from "../../schemas/product-line.ts";
import type {
  ConsolidateProductLineBody,
  ProductLineCreateBody,
  SplitProductLineBody,
} from "./routes.ts";

export async function getProductLine({
  productLineId,
}: {
  productLineId: string;
}): Promise<ProductLine | null> {
  const [row] = await db
    .select()
    .from(productLines)
    .where(eq(productLines.productLineId, productLineId));
  return row ?? null;
}

export async function listProductLines(): Promise<ProductLine[]> {
  return db.select().from(productLines);
}

/**
 * The symmetric adjacency of the synchronization graph: A listing B and B
 * listing A are the same edge, so each direction implies the other. The
 * table is team-scale, so a full read per check is fine.
 */
async function syncAdjacency(): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(productLines);
  const adjacency = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.deprecatedAt !== null) {
      continue;
    }
    const partners = adjacency.get(row.productLineId) ?? new Set<string>();
    for (const partnerId of row.forceBillingCycleSynchronizationWithProductLineIds) {
      partners.add(partnerId);
      const reverse = adjacency.get(partnerId) ?? new Set<string>();
      reverse.add(row.productLineId);
      adjacency.set(partnerId, reverse);
    }
    adjacency.set(row.productLineId, partners);
  }
  return adjacency;
}

/**
 * Every line synchronized with this one, directly or transitively (the
 * connected component), including the line itself. Synchronized tenants
 * share one cycle anchor across the whole component.
 */
export async function getSynchronizedLineIds({
  productLineId,
}: {
  productLineId: string;
}): Promise<Set<string>> {
  const adjacency = await syncAdjacency();
  const component = new Set<string>([productLineId]);
  const queue = [productLineId];
  for (let i = 0; i < queue.length && i < 10_000; i++) {
    for (const partner of adjacency.get(queue[i]) ?? []) {
      if (!component.has(partner)) {
        component.add(partner);
        queue.push(partner);
      }
    }
  }
  return component;
}

/** True when every given line sits in one synchronization component. */
export async function areLinesSynchronized({
  productLineIds,
}: {
  productLineIds: string[];
}): Promise<boolean> {
  if (productLineIds.length <= 1) {
    return true;
  }
  const component = await getSynchronizedLineIds({
    productLineId: productLineIds[0],
  });
  return productLineIds.every((lineId) => component.has(lineId));
}

/** Validate sync edge targets: they must exist, be active, and not be self. */
async function syncTargetsError({
  productLineId,
  syncIds,
}: {
  productLineId: string;
  syncIds: string[];
}): Promise<string | null> {
  if (new Set(syncIds).size !== syncIds.length) {
    return "synchronization targets must be distinct";
  }
  if (syncIds.includes(productLineId)) {
    return "a product line cannot synchronize with itself";
  }
  if (syncIds.length === 0) {
    return null;
  }
  const targets = await db
    .select()
    .from(productLines)
    .where(inArray(productLines.productLineId, syncIds));
  if (
    targets.length !== syncIds.length ||
    targets.some((target) => target.deprecatedAt !== null)
  ) {
    return "synchronization targets must be existing, active product lines";
  }
  return null;
}

export async function createProductLine({
  productLine,
}: {
  productLine: ProductLineCreateBody;
}): Promise<ProductLine | { error: string }> {
  const productLineId = generateId({ prefix: "product_line" });
  const syncError = await syncTargetsError({
    productLineId,
    syncIds: productLine.forceBillingCycleSynchronizationWithProductLineIds,
  });
  if (syncError !== null) {
    return { error: syncError };
  }
  const created: ProductLine = {
    productLineId,
    createdAt: Date.now(),
    deprecatedAt: null,
    forceBillingCycleSynchronizationWithProductLineIds:
      productLine.forceBillingCycleSynchronizationWithProductLineIds,
    name: productLine.name,
    description: productLine.description,
  };
  await db.insert(productLines).values(created).onConflictDoNothing();
  await repairSynchronizedAssignments({ productLineId });
  return created;
}

/**
 * Repair pass after the sync graph changes around a line: synchronized
 * lines must share one cycle anchor per tenant, and existing assignments
 * predate the edge. Each tenant with open assignments in several lines of
 * the component is normalized onto the earliest assignment's
 * startsAt/cycleId (earliest = the anchor the group has billed on longest).
 * Meter balances are untouched: only the cycle anchor moves.
 */
async function repairSynchronizedAssignments({
  productLineId,
}: {
  productLineId: string;
}): Promise<void> {
  const component = await getSynchronizedLineIds({ productLineId });
  if (component.size <= 1) {
    return;
  }
  const rows = await db
    .select()
    .from(assignments)
    .where(
      and(
        isNull(assignments.endsAt),
        inArray(assignments.productLineId, [...component]),
      ),
    )
    .orderBy(asc(assignments.startsAt), asc(assignments.createdAt));
  const byTenant = new Map<string, typeof rows>();
  for (const row of rows) {
    byTenant.set(row.tenantId, [...(byTenant.get(row.tenantId) ?? []), row]);
  }
  for (const group of byTenant.values()) {
    if (group.length <= 1) {
      continue;
    }
    const anchor = group[0];
    for (const assignment of group.slice(1)) {
      if (
        assignment.startsAt === anchor.startsAt &&
        assignment.cycleId === anchor.cycleId
      ) {
        continue;
      }
      console.log(
        `synchronization repair: tenant ${assignment.tenantId} assignment ${assignment.assignmentId} re-anchored to cycle ${anchor.cycleId} starting ${anchor.startsAt}`,
      );
      await db
        .update(assignments)
        .set({ cycleId: anchor.cycleId, startsAt: anchor.startsAt })
        .where(eq(assignments.assignmentId, assignment.assignmentId));
    }
  }
}

/**
 * Replace a line's synchronization edges, then repair: existing
 * assignments across the newly joined component are normalized onto one
 * anchor per tenant (repairSynchronizedAssignments).
 */
export async function patchProductLine({
  patch,
  productLineId,
}: {
  patch: { forceBillingCycleSynchronizationWithProductLineIds: string[] };
  productLineId: string;
}): Promise<ProductLine | null | { error: string }> {
  const existing = await getProductLine({ productLineId });
  if (!existing || existing.deprecatedAt !== null) {
    return null;
  }
  const syncError = await syncTargetsError({
    productLineId,
    syncIds: patch.forceBillingCycleSynchronizationWithProductLineIds,
  });
  if (syncError !== null) {
    return { error: syncError };
  }
  await db
    .update(productLines)
    .set({
      forceBillingCycleSynchronizationWithProductLineIds:
        patch.forceBillingCycleSynchronizationWithProductLineIds,
    })
    .where(eq(productLines.productLineId, productLineId));
  await repairSynchronizedAssignments({ productLineId });
  return getProductLine({ productLineId });
}

/** True when the line has any synchronization edge, outgoing or incoming. */
async function hasSyncEdges({
  productLineId,
}: {
  productLineId: string;
}): Promise<boolean> {
  const adjacency = await syncAdjacency();
  return (adjacency.get(productLineId)?.size ?? 0) > 0;
}

/** Deprecate the product line, stripping it from every line's sync list. */
export async function deprecateProductLine({
  productLineId,
}: {
  productLineId: string;
}): Promise<ProductLine | null> {
  const updated = await db
    .update(productLines)
    .set({ deprecatedAt: Date.now() })
    .where(eq(productLines.productLineId, productLineId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  // Deprecated lines leave the graph: no dangling edges.
  const referrers = await db
    .select()
    .from(productLines)
    .where(
      sql`${productLines.forceBillingCycleSynchronizationWithProductLineIds} @> ARRAY[${productLineId}]::text[]`,
    );
  for (const referrer of referrers) {
    await db
      .update(productLines)
      .set({
        forceBillingCycleSynchronizationWithProductLineIds:
          referrer.forceBillingCycleSynchronizationWithProductLineIds.filter(
            (id) => id !== productLineId,
          ),
      })
      .where(eq(productLines.productLineId, referrer.productLineId));
  }
  return getProductLine({ productLineId });
}

export type SplitResult = {
  deprecatedProductLineId: string;
  targets: {
    productLineId: string;
    features: number;
    meters: number;
    plans: number;
    addOnTypes: number;
    assignments: number;
  }[];
};

export type SplitError = {
  error: string;
  /** Plan or add-on type ids whose references straddle the partition. */
  straddlers?: string[];
  /** Entity ids not covered by exactly one target's lists. */
  unpartitioned?: string[];
};

/**
 * Split a product line into empty target lines: every feature is
 * partitioned exactly once; meters may land in several targets (a meter
 * spanning lines keeps its other lines and gains each target that claims
 * it). Plans and add-on types follow their references (a plan whose
 * features, meters, or add-on types straddle targets is rejected), and
 * assignments follow their plan with startsAt/cycleId untouched -- so rule
 * windows and quota counters see no change. Targets must be empty (no
 * plans, no assignments): a tenant's one open assignment in the source line
 * then lands in a line where they hold none, and the one-open-per-line
 * invariant is preserved by construction. A line with synchronization
 * edges can't split: which targets inherit the edges is ambiguous, so the
 * operator removes them first.
 */
export async function splitProductLine({
  body,
  productLineId,
}: {
  body: SplitProductLineBody;
  productLineId: string;
}): Promise<SplitResult | SplitError | null> {
  const source = await getProductLine({ productLineId });
  if (!source || source.deprecatedAt !== null) {
    return null;
  }
  if (await hasSyncEdges({ productLineId })) {
    return {
      error:
        "this line has billing-cycle synchronization edges; remove them (on it or on the lines referencing it) before splitting",
    };
  }
  const targetIds = body.targets.map((target) => target.productLineId);
  if (
    new Set(targetIds).size !== targetIds.length ||
    targetIds.includes(productLineId)
  ) {
    return { error: "targets must be distinct lines other than the source" };
  }
  const targetLines = await db
    .select()
    .from(productLines)
    .where(inArray(productLines.productLineId, targetIds));
  if (
    targetLines.length !== targetIds.length ||
    targetLines.some((line) => line.deprecatedAt !== null)
  ) {
    return { error: "every target must be an active product line" };
  }
  const [targetPlans, targetAssignments] = await Promise.all([
    db.select().from(plans).where(inArray(plans.productLineId, targetIds)),
    db
      .select()
      .from(assignments)
      .where(inArray(assignments.productLineId, targetIds)),
  ]);
  if (targetPlans.length > 0 || targetAssignments.length > 0) {
    return { error: "targets must be empty lines (no plans, no assignments)" };
  }

  // Every source feature must be covered by exactly one target. Meters may
  // span lines, so a source meter must be claimed by at least one target and
  // keeps every other line it already applies to.
  const [sourceFeatures, sourceMeters, sourcePlans, sourceAddOnTypes] =
    await Promise.all([
      db
        .select()
        .from(features)
        .where(eq(features.productLineId, productLineId)),
      db
        .select()
        .from(meters)
        .where(
          sql`${meters.productLineIds} @> ARRAY[${productLineId}]::text[]`,
        ),
      db.select().from(plans).where(eq(plans.productLineId, productLineId)),
      db
        .select()
        .from(addOnTypes)
        .where(eq(addOnTypes.productLineId, productLineId)),
    ]);
  const ownerOf = new Map<string, string>();
  for (const target of body.targets) {
    for (const id of target.featureIds) {
      if (ownerOf.has(id)) {
        return { error: `${id} is listed by more than one target` };
      }
      ownerOf.set(id, target.productLineId);
    }
  }
  const meterTargets = new Map<string, string[]>();
  const sourceMeterIds = new Set(sourceMeters.map((meter) => meter.meterId));
  for (const target of body.targets) {
    for (const id of target.meterIds) {
      if (!sourceMeterIds.has(id)) {
        return { error: `${id} is not a meter of the source line` };
      }
      meterTargets.set(id, [
        ...(meterTargets.get(id) ?? []),
        target.productLineId,
      ]);
    }
  }
  const unpartitioned = [
    ...sourceFeatures.map((feature) => feature.featureId),
    ...sourceMeters
      .map((meter) => meter.meterId)
      .filter((id) => !meterTargets.has(id)),
  ].filter((id) => !ownerOf.has(id) && !meterTargets.has(id));
  const foreign = [...ownerOf.keys()].filter(
    (id) => !sourceFeatures.map((f) => f.featureId).includes(id),
  );
  if (unpartitioned.length > 0 || foreign.length > 0) {
    return {
      error:
        "every feature must map to exactly one target; every meter to at least one",
      unpartitioned: [...unpartitioned, ...foreign],
    };
  }

  // Resolve each plan's target: its features, meters, and add-on types must
  // all land in one target. Unreferenced plans use the explicit planIds.
  const explicitPlan = new Map<string, string>();
  const explicitAddOnType = new Map<string, string>();
  for (const target of body.targets) {
    for (const id of target.planIds ?? []) {
      explicitPlan.set(id, target.productLineId);
    }
    for (const id of target.addOnTypeIds ?? []) {
      explicitAddOnType.set(id, target.productLineId);
    }
  }
  const addOnTypeFeatureRows = sourceAddOnTypes.length
    ? await db
        .select()
        .from(addOnTypeFeatures)
        .where(
          inArray(
            addOnTypeFeatures.addOnTypeId,
            sourceAddOnTypes.map((addOnType) => addOnType.addOnTypeId),
          ),
        )
    : [];
  const addOnTypeTarget = new Map<string, string>();
  const straddlers: string[] = [];
  for (const addOnType of sourceAddOnTypes) {
    const targets = new Set<string>();
    for (const row of addOnTypeFeatureRows) {
      if (row.addOnTypeId === addOnType.addOnTypeId) {
        targets.add(ownerOf.get(row.featureId) as string);
      }
    }
    const explicit = explicitAddOnType.get(addOnType.addOnTypeId);
    if (explicit !== undefined) {
      targets.add(explicit);
    }
    if (targets.size > 1) {
      straddlers.push(addOnType.addOnTypeId);
      continue;
    }
    if (targets.size === 1) {
      addOnTypeTarget.set(addOnType.addOnTypeId, [...targets][0]);
    }
  }
  const planIds = sourcePlans.map((plan) => plan.planId);
  const [planFeatureRows, planMeterRows, planAddOnTypeRows] = planIds.length
    ? await Promise.all([
        db
          .select()
          .from(planFeatures)
          .where(inArray(planFeatures.planId, planIds)),
        db.select().from(planMeters).where(inArray(planMeters.planId, planIds)),
        db
          .select()
          .from(planAddOnTypes)
          .where(inArray(planAddOnTypes.planId, planIds)),
      ])
    : [[], [], []];
  const planTarget = new Map<string, string>();
  for (const plan of sourcePlans) {
    const targets = new Set<string>();
    for (const row of planFeatureRows) {
      if (row.planId === plan.planId) {
        targets.add(ownerOf.get(row.featureId) as string);
      }
    }
    for (const row of planMeterRows) {
      if (row.planId === plan.planId) {
        const claimed = meterTargets.get(row.meterId);
        /* A meter claimed by several targets keeps the plan's line as long as
         * one target claims it; the plan follows any single claim only when
         * the meter stays in exactly one target. A multi-target meter makes
         * the plan's target ambiguous, so it must be pinned explicitly. */
        if (!claimed || claimed.length !== 1) {
          straddlers.push(plan.planId);
          break;
        }
        targets.add(claimed[0]);
      }
    }
    for (const row of planAddOnTypeRows) {
      if (row.planId === plan.planId) {
        const addOnTarget = addOnTypeTarget.get(row.addOnTypeId);
        if (addOnTarget === undefined) {
          // An add-on type with no resolved target (no features, no explicit
          // assignment): the plan can't pin it either.
          straddlers.push(row.addOnTypeId);
          continue;
        }
        targets.add(addOnTarget);
      }
    }
    const explicit = explicitPlan.get(plan.planId);
    if (explicit !== undefined) {
      targets.add(explicit);
    }
    if (targets.size !== 1) {
      straddlers.push(plan.planId);
      continue;
    }
    planTarget.set(plan.planId, [...targets][0]);
  }
  const unassignedAddOnTypes = sourceAddOnTypes
    .map((addOnType) => addOnType.addOnTypeId)
    .filter((id) => !addOnTypeTarget.has(id) && !straddlers.includes(id));
  straddlers.push(...unassignedAddOnTypes);
  if (straddlers.length > 0) {
    return {
      error:
        "plans and add-on types must land in exactly one target (set planIds/addOnTypeIds for unreferenced ones)",
      straddlers,
    };
  }

  const sourceAssignments = await db
    .select()
    .from(assignments)
    .where(eq(assignments.productLineId, productLineId));

  const result = await db.transaction(async (tx) => {
    const counts = new Map<string, SplitResult["targets"][number]>();
    for (const target of body.targets) {
      counts.set(target.productLineId, {
        productLineId: target.productLineId,
        features: 0,
        meters: 0,
        plans: 0,
        addOnTypes: 0,
        assignments: 0,
      });
    }
    for (const feature of sourceFeatures) {
      const target = ownerOf.get(feature.featureId) as string;
      await tx
        .update(features)
        .set({ productLineId: target })
        .where(eq(features.featureId, feature.featureId));
      (counts.get(target) as SplitResult["targets"][number]).features += 1;
    }
    for (const meter of sourceMeters) {
      const claimedBy = meterTargets.get(meter.meterId) ?? [];
      /* Replace the source line with every claiming target; other lines the
       * meter already applies to are kept. */
      const newLineIds = [
        ...meter.productLineIds.filter((lineId) => lineId !== productLineId),
        ...claimedBy,
      ];
      await tx
        .update(meters)
        .set({ productLineIds: newLineIds })
        .where(eq(meters.meterId, meter.meterId));
      for (const target of claimedBy) {
        (counts.get(target) as SplitResult["targets"][number]).meters += 1;
      }
    }
    for (const [addOnTypeId, target] of addOnTypeTarget) {
      await tx
        .update(addOnTypes)
        .set({ productLineId: target })
        .where(eq(addOnTypes.addOnTypeId, addOnTypeId));
      (counts.get(target) as SplitResult["targets"][number]).addOnTypes += 1;
    }
    for (const [planId, target] of planTarget) {
      await tx
        .update(plans)
        .set({ productLineId: target })
        .where(eq(plans.planId, planId));
      (counts.get(target) as SplitResult["targets"][number]).plans += 1;
    }
    for (const assignment of sourceAssignments) {
      const target = planTarget.get(assignment.planId);
      if (target === undefined) {
        continue;
      }
      await tx
        .update(assignments)
        .set({ productLineId: target })
        .where(eq(assignments.assignmentId, assignment.assignmentId));
      (counts.get(target) as SplitResult["targets"][number]).assignments += 1;
    }
    await tx
      .update(productLines)
      .set({ deprecatedAt: Date.now() })
      .where(eq(productLines.productLineId, productLineId));
    return {
      deprecatedProductLineId: productLineId,
      targets: body.targets.map(
        (target) =>
          counts.get(target.productLineId) as SplitResult["targets"][number],
      ),
    };
  });
  return result;
}

export type ConsolidateResult = {
  consolidatedProductLineId: string;
  deprecatedProductLineId: string;
  /** Loser assignments ended by the collision resolutions. */
  endedAssignmentIds: string[];
};

export type ConsolidateError = {
  error: string;
  /** Colliding tenants with no resolution supplied. */
  missingResolutions?: string[];
};

/**
 * Consolidate the source line into this one: all of the source's features,
 * meters, add-on types, plans, and assignments move over. Tenants with an
 * open assignment in both lines collide on the one-open-per-line invariant,
 * so each collision needs an explicit resolution (keep the source's or the
 * target's assignment); the loser ends now. The winner keeps its
 * startsAt/cycleId, so its rule windows are untouched; the losing line's
 * quota windows reset.
 */
export async function consolidateProductLine({
  body,
  productLineId,
}: {
  body: ConsolidateProductLineBody;
  productLineId: string;
}): Promise<ConsolidateResult | ConsolidateError | null> {
  const { sourceProductLineId } = body;
  if (sourceProductLineId === productLineId) {
    return { error: "source and target must be different lines" };
  }
  const [target, source] = await Promise.all([
    getProductLine({ productLineId }),
    getProductLine({ productLineId: sourceProductLineId }),
  ]);
  if (
    !target ||
    !source ||
    target.deprecatedAt !== null ||
    source.deprecatedAt !== null
  ) {
    return null;
  }
  /* Merging lines would merge or strand their synchronization groups
   * silently, changing which assignments can be created. The operator
   * removes the edges first. */
  if (
    (await hasSyncEdges({ productLineId })) ||
    (await hasSyncEdges({ productLineId: sourceProductLineId }))
  ) {
    return {
      error:
        "source or target has billing-cycle synchronization edges; remove them before consolidating",
    };
  }

  // Collisions: tenants with an open assignment in both lines.
  const openIn = async (ofProductLineId: string) =>
    db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.productLineId, ofProductLineId),
          isNull(assignments.endsAt),
        ),
      );
  const [targetOpen, sourceOpen] = await Promise.all([
    openIn(productLineId),
    openIn(sourceProductLineId),
  ]);
  const targetOpenByTenant = new Map(
    targetOpen.map((assignment) => [assignment.tenantId, assignment]),
  );
  const collisions = sourceOpen.filter((assignment) =>
    targetOpenByTenant.has(assignment.tenantId),
  );
  const resolutionByTenant = new Map(
    body.resolutions.map((resolution) => [
      resolution.tenantId,
      resolution.keep,
    ]),
  );
  const missingResolutions = collisions
    .map((assignment) => assignment.tenantId)
    .filter((tenantId) => !resolutionByTenant.has(tenantId));
  if (missingResolutions.length > 0) {
    return {
      error: "every colliding tenant needs a resolution",
      missingResolutions,
    };
  }

  const now = Date.now();
  const endedAssignmentIds: string[] = [];
  await db.transaction(async (tx) => {
    /* Losers end BEFORE the source assignments move: the one-open-per-line
     * index is checked per statement, so the move must never see two open
     * assignments for a colliding tenant in the target line. */
    for (const collision of collisions) {
      const targetAssignment = targetOpenByTenant.get(
        collision.tenantId,
      ) as (typeof sourceOpen)[number];
      const loser =
        resolutionByTenant.get(collision.tenantId) === "source"
          ? targetAssignment
          : collision;
      endedAssignmentIds.push(loser.assignmentId);
      await tx
        .update(assignments)
        .set({ endsAt: now })
        .where(eq(assignments.assignmentId, loser.assignmentId));
    }
    await tx
      .update(features)
      .set({ productLineId })
      .where(eq(features.productLineId, sourceProductLineId));
    /* Meters may span lines: replace the source with the target in each
     * affected meter's list (deduped: the meter may already apply to the
     * target). */
    const sourceMeters = await tx
      .select()
      .from(meters)
      .where(
        sql`${meters.productLineIds} @> ARRAY[${sourceProductLineId}]::text[]`,
      );
    for (const meter of sourceMeters) {
      await tx
        .update(meters)
        .set({
          productLineIds: [
            ...new Set(
              meter.productLineIds.map((lineId) =>
                lineId === sourceProductLineId ? productLineId : lineId,
              ),
            ),
          ],
        })
        .where(eq(meters.meterId, meter.meterId));
    }
    await tx
      .update(addOnTypes)
      .set({ productLineId })
      .where(eq(addOnTypes.productLineId, sourceProductLineId));
    await tx
      .update(plans)
      .set({ productLineId })
      .where(eq(plans.productLineId, sourceProductLineId));
    await tx
      .update(assignments)
      .set({ productLineId })
      .where(eq(assignments.productLineId, sourceProductLineId));
    await tx
      .update(productLines)
      .set({ deprecatedAt: now })
      .where(eq(productLines.productLineId, sourceProductLineId));
  });
  return {
    consolidatedProductLineId: productLineId,
    deprecatedProductLineId: sourceProductLineId,
    endedAssignmentIds,
  };
}
