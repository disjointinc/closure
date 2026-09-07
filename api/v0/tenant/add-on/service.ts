/**
 * v0/tenant/add-on/service.ts -- add-on instance business logic. An add-on is
 * a first-class attach of an add-on type to an assignment; it detaches
 * (soft-deletes) by its own id.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { assignmentAddOns, assignments } from "../../../db/schema.ts";
import type { AddOn } from "../../../schemas/add-on.ts";

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

/** Attach an add-on, or return null if no such assignment exists. */
export async function attachAddOn({
  addOn,
}: {
  addOn: AddOn;
}): Promise<AddOn | null> {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.assignmentId, addOn.assignmentId));
  if (!assignment) {
    return null;
  }
  await db
    .insert(assignmentAddOns)
    .values({
      addOnId: addOn.addOnId,
      assignmentId: addOn.assignmentId,
      addOnTypeId: addOn.addOnTypeId,
      startsAt: addOn.startsAt,
      endsAt: addOn.endsAt,
      deletedAt: null,
    })
    .onConflictDoNothing();
  return getAddOn({ addOnId: addOn.addOnId });
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
