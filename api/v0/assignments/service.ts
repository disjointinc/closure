/**
 * v0/assignments/service.ts -- assignment business logic. Assignments are
 * never deleted: creating a new one ends the tenant's currently-open
 * assignment. Creating an assignment also initializes the tenant's meter
 * balances (in Redis) from the plan's default allocations.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { setMeterBalance } from "../../cache/metering.ts";
import { db } from "../../db/index.ts";
import { assignmentAddOns, assignments, planMeters } from "../../db/schema.ts";
import type { Assignment } from "../../schemas/assignment.ts";
import type { AddOnAttachBody } from "./routes.ts";

export async function getAssignment({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Assignment | null> {
  const [row] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const addOnRows = await db
    .select()
    .from(assignmentAddOns)
    .where(eq(assignmentAddOns.assignment, uniqueId));
  return {
    unique_id: row.uniqueId,
    plan: row.plan,
    experiment: row.experiment,
    cycle: row.cycle,
    start: row.start,
    end: row.end,
    add_ons: addOnRows.map((addOn) => ({
      start: addOn.start,
      end: addOn.end,
      add_on: addOn.addOn,
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
    .where(eq(assignments.tenant, tenantId))
    .orderBy(desc(assignments.start));
  const found = await Promise.all(
    rows.map((row) => getAssignment({ uniqueId: row.uniqueId })),
  );
  return found.filter((assignment) => assignment !== null);
}

export async function createAssignment({
  assignment,
  tenantId,
}: {
  assignment: Assignment;
  tenantId: string;
}): Promise<Assignment | null> {
  // A new assignment supersedes the tenant's currently-open one.
  await db
    .update(assignments)
    .set({ end: assignment.start })
    .where(and(eq(assignments.tenant, tenantId), isNull(assignments.end)));
  await db
    .insert(assignments)
    .values({
      uniqueId: assignment.unique_id,
      tenant: tenantId,
      plan: assignment.plan,
      experiment: assignment.experiment,
      cycle: assignment.cycle,
      start: assignment.start,
      end: assignment.end,
    })
    .onConflictDoNothing();
  if (assignment.add_ons.length > 0) {
    await db
      .insert(assignmentAddOns)
      .values(
        assignment.add_ons.map((addOn) => ({
          assignment: assignment.unique_id,
          addOn: addOn.add_on,
          start: addOn.start,
          end: addOn.end,
        })),
      )
      .onConflictDoNothing();
  }
  // Initialize meter balances from the plan's default allocations.
  const meterRows = await db
    .select()
    .from(planMeters)
    .where(eq(planMeters.plan, assignment.plan));
  for (const meter of meterRows) {
    await setMeterBalance({
      balanceMicrocredits: meter.defaultMicrocredits,
      meterId: meter.meter,
      tenantId,
    });
  }
  return getAssignment({ uniqueId: assignment.unique_id });
}

/** Attach an add-on, or return null if no such assignment exists. */
export async function attachAddOn({
  addOn,
  assignmentId,
}: {
  addOn: AddOnAttachBody;
  assignmentId: string;
}): Promise<Assignment | null> {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.uniqueId, assignmentId));
  if (!assignment) {
    return null;
  }
  await db
    .insert(assignmentAddOns)
    .values({
      assignment: assignmentId,
      addOn: addOn.add_on,
      start: addOn.start,
      end: addOn.end,
    })
    .onConflictDoNothing();
  return getAssignment({ uniqueId: assignmentId });
}
