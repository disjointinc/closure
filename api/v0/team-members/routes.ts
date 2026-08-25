/**
 * v0/team-members/routes.ts -- HTTP for /v0/team-members: request validation
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

const teamMemberPatchSchema = z
  .object({
    name: z.string().min(1).nullable(),
    profile_picture_link: z.url().nullable(),
  })
  .partial();

export type TeamMemberPatchBody = z.infer<typeof teamMemberPatchSchema>;

export const teamMembersApp = new Hono()
  .post("/", zValidator("json", teamMemberSchema), async (c) => {
    const body = c.req.valid("json");
    await createTeamMember({ teamMember: body });
    return c.json(body, 201);
  })
  .get("/", async (c) => {
    return c.json(await listTeamMembers());
  })
  .get("/:id", async (c) => {
    const teamMember = await getTeamMember({ uniqueId: c.req.param("id") });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember);
  })
  .patch("/:id", zValidator("json", teamMemberPatchSchema), async (c) => {
    const teamMember = await patchTeamMember({
      patch: c.req.valid("json"),
      uniqueId: c.req.param("id"),
    });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember);
  })
  .delete("/:id", async (c) => {
    const teamMember = await deleteTeamMember({
      uniqueId: c.req.param("id"),
    });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember);
  });
