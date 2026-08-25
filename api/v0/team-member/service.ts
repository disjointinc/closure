/**
 * v0/team-member/service.ts -- team member business logic (users of the
 * pricing application).
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { teamMembers } from "../../db/schema.ts";
import type { TeamMember } from "../../schemas/team-member.ts";
import type { TeamMemberPatchBody } from "./routes.ts";

function rowToTeamMember(row: typeof teamMembers.$inferSelect): TeamMember {
  return {
    unique_id: row.uniqueId,
    deleted_at: row.deletedAt,
    email_address: row.emailAddress,
    name: row.name,
    profile_picture_link: row.profilePictureLink,
  };
}

export async function getTeamMember({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<TeamMember | null> {
  const [row] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  return rowToTeamMember(row);
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const rows = await db.select().from(teamMembers);
  return rows.map(rowToTeamMember);
}

export async function createTeamMember({
  teamMember,
}: {
  teamMember: TeamMember;
}): Promise<void> {
  await db
    .insert(teamMembers)
    .values({
      uniqueId: teamMember.unique_id,
      deletedAt: teamMember.deleted_at,
      emailAddress: teamMember.email_address,
      name: teamMember.name,
      profilePictureLink: teamMember.profile_picture_link,
    })
    .onConflictDoNothing();
}

/** Soft-delete the team member, or return null if no such member exists. */
export async function deleteTeamMember({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<TeamMember | null> {
  const updated = await db
    .update(teamMembers)
    .set({ deletedAt: Date.now() })
    .where(eq(teamMembers.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToTeamMember(updated[0]);
}

/** Patch the team member, or return null if no such team member exists. */
export async function patchTeamMember({
  patch,
  uniqueId,
}: {
  patch: TeamMemberPatchBody;
  uniqueId: string;
}): Promise<TeamMember | null> {
  const updated = await db
    .update(teamMembers)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.profile_picture_link !== undefined
        ? { profilePictureLink: patch.profile_picture_link }
        : {}),
    })
    .where(eq(teamMembers.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return rowToTeamMember(updated[0]);
}
