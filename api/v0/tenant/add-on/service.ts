/**
 * v0/tenant/add-on/service.ts -- add-on instance business logic. An add-on is
 * a first-class attach of an add-on type to an assignment; it detaches
 * (soft-deletes) by its own id.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { assignmentAddOns, assignments } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { AddOn } from "../../../schemas/add-on.ts";
import type { AddOnCreateBody } from "./routes.ts";

export async function listAddOns({
  tenantId,
}: {
  tenantId: string;
}): Promise<AddOn[]> {
  const rows = await db
    .select({ addOn: assignmentAddOns })
    .from(assignmentAddOns)
    .innerJoin(
      assignments,
      eq(assignmentAddOns.assignmentId, assignments.assignmentId),
    )
    .where(eq(assignments.tenantId, tenantId))
    .orderBy(desc(assignmentAddOns.startsAt));
  return rows.map((row) => row.addOn);
}

export async function getAddOn({
  addOnId,
}: {
  addOnId: string;
}): Promise<AddOn | null> {
  const [row] = await db
    .select()
    .from(assignmentAddOns)
    .where(eq(assignmentAddOns.addOnId, addOnId));
  return row ?? null;
}

/** Attach an add-on to the tenant's open assignment, or null if none. */
export async function attachAddOn({
  addOn,
  tenantId,
}: {
  addOn: AddOnCreateBody;
  tenantId: string;
}): Promise<AddOn | null> {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.tenantId, tenantId), isNull(assignments.endsAt)));
  if (!assignment) {
    return null;
  }
  const addOnId = generateId({ prefix: "add_on" });
  await db
    .insert(assignmentAddOns)
    .values({
      addOnId,
      assignmentId: assignment.assignmentId,
      addOnTypeId: addOn.addOnTypeId,
      createdAt: Date.now(),
      startsAt: addOn.startsAt ?? Date.now(),
      endsAt: addOn.endsAt,
      deletedAt: null,
    })
    .onConflictDoNothing();
  return getAddOn({ addOnId });
}

/** Soft-delete an add-on, or return null if it is already deleted. */
export async function deleteAddOn({
  addOnId,
}: {
  addOnId: string;
}): Promise<AddOn | null> {
  const active = await getAddOn({ addOnId });
  if (!active || active.deletedAt !== null) {
    return null;
  }
  await db
    .update(assignmentAddOns)
    .set({ deletedAt: Date.now() })
    .where(eq(assignmentAddOns.addOnId, addOnId));
  return getAddOn({ addOnId });
}
