/**
 * v0/tenant/assignment/routes.ts -- HTTP for /v0/tenant/:tenantId/assignment: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../../lib/http.ts";
import { assignmentSchema } from "../../../schemas/assignment.ts";
import { assignmentIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import {
  createAssignment,
  endAssignment,
  getAssignment,
  listAssignments,
} from "./service.ts";

// Ids and lifecycle timestamps are server-minted (productLineId comes from
// the plan): the body carries the plan/cycle references and the add-on terms.
const assignmentCreateSchema = assignmentSchema
  .omit({ assignmentId: true, createdAt: true, productLineId: true })
  .extend({
    addOns: z.array(
      assignmentSchema.shape.addOns.element.omit({
        addOnId: true,
        createdAt: true,
        deletedAt: true,
      }),
    ),
  });

export type AssignmentCreateBody = z.infer<typeof assignmentCreateSchema>;

const createAssignmentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/assignment"],
  summary: "Create an assignment",
  request: {
    body: {
      content: { "application/json": { schema: assignmentCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: assignmentSchema } },
      description: "Created",
    },
    400: invalidResponse,
    404: notFoundResponse,
  },
});

const listAssignmentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/assignment"],
  summary: "List assignments",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(assignmentSchema) } },
      description: "OK",
    },
  },
});

const getAssignmentRoute = createRoute({
  method: "get",
  path: "/{assignmentId}",
  tags: ["tenant/assignment"],
  summary: "Get an assignment",
  request: {
    params: z.object({
      assignmentId: assignmentIdSchema,
      tenantId: tenantIdSchema,
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: assignmentSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const endAssignmentRoute = createRoute({
  method: "patch",
  path: "/{assignmentId}/end",
  tags: ["tenant/assignment"],
  summary: "End an assignment",
  request: {
    params: z.object({
      assignmentId: assignmentIdSchema,
      tenantId: tenantIdSchema,
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: assignmentSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const assignmentApp = new OpenAPIHono<{
  Variables: { tenantId: string };
}>()
  .openapi(createAssignmentRoute, async (c) => {
    const tenantId = c.get("tenantId");
    const assignment = await createAssignment({
      assignment: c.req.valid("json"),
      tenantId,
    });
    if (!assignment) {
      return c.json({ error: "Plan not found" }, 404);
    }
    if ("error" in assignment) {
      return c.json(assignment, 400);
    }
    return c.json(assignment, 201);
  })
  .openapi(listAssignmentsRoute, async (c) => {
    return c.json(await listAssignments({ tenantId: c.get("tenantId") }), 200);
  })
  .openapi(getAssignmentRoute, async (c) => {
    const assignment = await getAssignment({
      assignmentId: c.req.param("assignmentId"),
    });
    if (!assignment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(assignment, 200);
  })
  .openapi(endAssignmentRoute, async (c) => {
    const assignment = await endAssignment({
      assignmentId: c.req.param("assignmentId"),
    });
    if (!assignment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(assignment, 200);
  });
