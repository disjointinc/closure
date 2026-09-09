/**
 * v0/tenant/assignment/service.ts -- assignment business logic. Assignments
 * are never deleted. A tenant may hold several open ones at once, but at
 * most one per product line: a new assignment in a line supersedes that
 * line's open one. Creating an assignment also initializes the tenant's
 * meter balances (in Redis) from the plan's default allocations.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { setMeterBalance } from "../../../cache/meter/index.ts";
import { db } from "../../../db/index.ts";
import {
  assignmentAddOns,
  assignments,
  planMeters,
  plans,
} from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { Assignment } from "../../../schemas/assignment.ts";
import { getSynchronizedLineIds } from "../../product-line/service.ts";
import type { AssignmentCreateBody } from "./routes.ts";

export async function getAssignment({
  assignmentId,
}: {
  assignmentId: string;
}): Promise<Assignment | null> {
  const [row] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.assignmentId, assignmentId));
  if (!row) {
    return null;
  }
  const addOnRows = await db
    .select()
    .from(assignmentAddOns)
    .where(eq(assignmentAddOns.assignmentId, assignmentId));
  return {
    assignmentId: row.assignmentId,
    planId: row.planId,
    productLineId: row.productLineId,
    experimentId: row.experimentId,
    cycleId: row.cycleId,
    createdAt: row.createdAt,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    addOns: addOnRows
      .filter((addOn) => addOn.deletedAt === null)
      .map((addOn) => ({
        addOnId: addOn.addOnId,
        addOnTypeId: addOn.addOnTypeId,
        createdAt: addOn.createdAt,
        startsAt: addOn.startsAt,
        endsAt: addOn.endsAt,
        deletedAt: addOn.deletedAt,
      })),
  };
}

export async function listAssignments({
  tenantId,
}: {
  tenantId: string;
}): Promise<Assignment[]> {
  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.tenantId, tenantId))
    .orderBy(desc(assignments.startsAt));
  const found = await Promise.all(
    rows.map((row) => getAssignment({ assignmentId: row.assignmentId })),
  );
  return found.filter((assignment) => assignment !== null);
}

/**
 * Billing-cycle synchronization pre-check, shared by createAssignment and
 * experiment enrollment (which validates a batch before writing anything):
 * if the plan's line is synchronized with other lines, the tenant's open
 * assignments in those lines define the group's anchor, and an assignment
 * with these terms must share it. Returns the error message, or null.
 */
export async function validateAssignmentTerms({
  cycleId,
  productLineId,
  startsAt,
  tenantId,
}: {
  cycleId: string;
  productLineId: string;
  startsAt: number;
  tenantId: string;
}): Promise<string | null> {
  const synchronized = await getSynchronizedLineIds({ productLineId });
  synchronized.delete(productLineId);
  if (synchronized.size === 0) {
    return null;
  }
  const groupAssignments = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.tenantId, tenantId),
        isNull(assignments.endsAt),
        inArray(assignments.productLineId, [...synchronized]),
      ),
    );
  const mismatch = groupAssignments.find(
    (open) => open.startsAt !== startsAt || open.cycleId !== cycleId,
  );
  if (mismatch === undefined) {
    return null;
  }
  return (
    `product line ${productLineId} is billing-cycle-synchronized ` +
    `with ${[...synchronized].join(", ")}: the tenant's open assignment ` +
    `there starts at ${mismatch.startsAt} on cycle ${mismatch.cycleId}, ` +
    `so this assignment must use the same startsAt and cycleId`
  );
}

export async function createAssignment({
  assignment,
  tenantId,
}: {
  assignment: AssignmentCreateBody;
  tenantId: string;
}): Promise<Assignment | null | { error: string }> {
  const [planRow] = await db
    .select()
    .from(plans)
    .where(eq(plans.planId, assignment.planId));
  if (!planRow) {
    return null;
  }
  const invalid = await validateAssignmentTerms({
    cycleId: assignment.cycleId,
    productLineId: planRow.productLineId,
    startsAt: assignment.startsAt,
    tenantId,
  });
  if (invalid !== null) {
    return { error: invalid };
  }
  // A new assignment supersedes the tenant's open one in the same line.
  await db
    .update(assignments)
    .set({ endsAt: assignment.startsAt })
    .where(
      and(
        eq(assignments.tenantId, tenantId),
        eq(assignments.productLineId, planRow.productLineId),
        isNull(assignments.endsAt),
      ),
    );
  const assignmentId = generateId({ prefix: "assignment" });
  const createdAt = Date.now();
  await db
    .insert(assignments)
    .values({
      assignmentId,
      tenantId,
      planId: assignment.planId,
      productLineId: planRow.productLineId,
      experimentId: assignment.experimentId,
      cycleId: assignment.cycleId,
      createdAt,
      startsAt: assignment.startsAt,
      endsAt: assignment.endsAt,
    })
    .onConflictDoNothing();
  if (assignment.addOns.length > 0) {
    await db
      .insert(assignmentAddOns)
      .values(
        assignment.addOns.map((addOn) => ({
          addOnId: generateId({ prefix: "add_on" }),
          assignmentId,
          addOnTypeId: addOn.addOnTypeId,
          createdAt,
          startsAt: addOn.startsAt,
          endsAt: addOn.endsAt,
          deletedAt: null,
        })),
      )
      .onConflictDoNothing();
  }
  // Initialize meter balances from the plan's default allocations.
  const meterRows = await db
    .select()
    .from(planMeters)
    .where(eq(planMeters.planId, assignment.planId));
  for (const meter of meterRows) {
    await setMeterBalance({
      balanceMicrocredits: meter.defaultMicrocredits,
      meterId: meter.meterId,
      tenantId,
    });
  }
  return getAssignment({ assignmentId });
}

/** End the assignment now, or return null if no such assignment exists. */
export async function endAssignment({
  assignmentId,
}: {
  assignmentId: string;
}): Promise<Assignment | null> {
  const updated = await db
    .update(assignments)
    .set({ endsAt: Date.now() })
    .where(eq(assignments.assignmentId, assignmentId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getAssignment({ assignmentId });
}
