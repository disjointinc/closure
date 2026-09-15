/**
 * v0/team-member/routes.ts -- HTTP for /v0/team-member: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { teamMemberIdSchema } from "../../schemas/ids.ts";
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

const createTeamMemberRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["team-member"],
  summary: "Create a team member",
  request: {
    body: {
      content: { "application/json": { schema: teamMemberCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: teamMemberSchema } },
      description: "Created",
    },
  },
});

const listTeamMembersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["team-member"],
  summary: "List team members",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(teamMemberSchema) } },
      description: "OK",
    },
  },
});

const getTeamMemberRoute = createRoute({
  method: "get",
  path: "/{teamMemberId}",
  tags: ["team-member"],
  summary: "Get a team member",
  request: { params: z.object({ teamMemberId: teamMemberIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: teamMemberSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const patchTeamMemberRoute = createRoute({
  method: "patch",
  path: "/{teamMemberId}",
  tags: ["team-member"],
  summary: "Patch a team member",
  request: {
    params: z.object({ teamMemberId: teamMemberIdSchema }),
    body: {
      content: { "application/json": { schema: teamMemberPatchSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: teamMemberSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deleteTeamMemberRoute = createRoute({
  method: "delete",
  path: "/{teamMemberId}",
  tags: ["team-member"],
  summary: "Delete a team member",
  request: { params: z.object({ teamMemberId: teamMemberIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: teamMemberSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const teamMemberApp = new OpenAPIHono()
  .openapi(createTeamMemberRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTeamMember({ teamMember: body }), 201);
  })
  .openapi(listTeamMembersRoute, async (c) => {
    return c.json(await listTeamMembers(), 200);
  })
  .openapi(getTeamMemberRoute, async (c) => {
    const teamMember = await getTeamMember({
      teamMemberId: c.req.param("teamMemberId"),
    });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember, 200);
  })
  .openapi(patchTeamMemberRoute, async (c) => {
    const teamMember = await patchTeamMember({
      patch: c.req.valid("json"),
      teamMemberId: c.req.param("teamMemberId"),
    });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember, 200);
  })
  .openapi(deleteTeamMemberRoute, async (c) => {
    const teamMember = await deleteTeamMember({
      teamMemberId: c.req.param("teamMemberId"),
    });
    if (!teamMember) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(teamMember, 200);
  });
