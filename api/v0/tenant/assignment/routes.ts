/**
 * v0/tenant/assignment/routes.ts -- HTTP for /v0/tenant/:tenantId/assignment: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { assignmentSchema } from "../../../schemas/assignment.ts";
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

export const assignmentApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", assignmentCreateSchema), async (c) => {
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
  .get("/", async (c) => {
    return c.json(await listAssignments({ tenantId: c.get("tenantId") }));
  })
  .get("/:assignmentId", async (c) => {
    const assignment = await getAssignment({
      assignmentId: c.req.param("assignmentId"),
    });
    if (!assignment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(assignment);
  })
  .patch("/:assignmentId/end", async (c) => {
    const assignment = await endAssignment({
      assignmentId: c.req.param("assignmentId"),
    });
    if (!assignment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(assignment);
  });
