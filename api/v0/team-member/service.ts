/**
 * v0/team-member/service.ts -- team member business logic (users of the
 * pricing application).
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { teamMembers } from "../../db/schema.ts";
import type { TeamMember } from "../../schemas/team-member.ts";
import type { TeamMemberPatchBody } from "./routes.ts";

export async function getTeamMember({
  teamMemberId,
}: {
  teamMemberId: string;
}): Promise<TeamMember | null> {
  const [row] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.teamMemberId, teamMemberId));
  return row ?? null;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  return db.select().from(teamMembers);
}

export async function createTeamMember({
  teamMember,
}: {
  teamMember: TeamMember;
}): Promise<void> {
  await db.insert(teamMembers).values(teamMember).onConflictDoNothing();
}

/** Soft-delete the team member, or return null if no such member exists. */
export async function deleteTeamMember({
  teamMemberId,
}: {
  teamMemberId: string;
}): Promise<TeamMember | null> {
  const updated = await db
    .update(teamMembers)
    .set({ deletedAt: Date.now() })
    .where(eq(teamMembers.teamMemberId, teamMemberId))
    .returning();
  return updated[0] ?? null;
}

/** Patch the team member, or return null if no such member exists. */
export async function patchTeamMember({
  patch,
  teamMemberId,
}: {
  patch: TeamMemberPatchBody;
  teamMemberId: string;
}): Promise<TeamMember | null> {
  const updated = await db
    .update(teamMembers)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.profilePictureUrl !== undefined
        ? { profilePictureUrl: patch.profilePictureUrl }
        : {}),
    })
    .where(eq(teamMembers.teamMemberId, teamMemberId))
    .returning();
  return updated[0] ?? null;
}
