/**
 * v0/team-member/routes.ts -- HTTP for /v0/team-member: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { teamMemberSchema } from "../../schemas/team-member.ts";
import {
  createTeamMember,
  deleteTeamMember,
  getTeamMember,
  listTeamMembers,
  patchTeamMember,
} from "./service.ts";

const teamMemberCreateSchema = teamMemberSchema.omit({
  teamMemberId: true,
  createdAt: true,
  deletedAt: true,
});

const teamMemberPatchSchema = z
  .object({
    name: z.string().min(1).nullable(),
    profilePictureUrl: z.url().nullable(),
  })
  .partial();

export type TeamMemberCreateBody = z.infer<typeof teamMemberCreateSchema>;
export type TeamMemberPatchBody = z.infer<typeof teamMemberPatchSchema>;

export const teamMemberApp = new Hono()
  .post("/", zValidator("json", teamMemberCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTeamMember({ teamMember: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listTeamMembers());
  })
  .get("/:teamMemberId", async (c) => {
    const teamMember = await getTeamMember({
      teamMemberId: c.req.param("teamMemberId"),
    });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember);
  })
  .patch(
    "/:teamMemberId",
    zValidator("json", teamMemberPatchSchema),
    async (c) => {
      const teamMember = await patchTeamMember({
        patch: c.req.valid("json"),
        teamMemberId: c.req.param("teamMemberId"),
      });
      if (!teamMember) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(teamMember);
    },
  )
  .delete("/:teamMemberId", async (c) => {
    const teamMember = await deleteTeamMember({
      teamMemberId: c.req.param("teamMemberId"),
    });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember);
  });
