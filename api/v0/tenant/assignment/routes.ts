/**
 * v0/tenant/assignment/routes.ts -- HTTP for /v0/tenant/:tenantId/assignment: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { assignmentSchema } from "../../../schemas/assignment.ts";
import {
  AssignmentBodyError,
  createAssignment,
  listAssignments,
} from "./service.ts";

// Ids and lifecycle timestamps are server-minted: the body carries the
// plan/cycle references and the loan/add-on terms.
const assignmentCreateSchema = assignmentSchema
  .omit({ assignmentId: true, createdAt: true })
  .extend({
    loan: assignmentSchema.shape.loan
      .unwrap()
      .omit({ loanId: true })
      .nullable(),
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
    const body = c.req.valid("json");
    try {
      const assignment = await createAssignment({
        assignment: body,
        tenantId,
      });
      if (!assignment) {
        return c.json({ error: "Plan not found" }, 404);
      }
      return c.json(assignment, 201);
    } catch (error) {
      if (error instanceof AssignmentBodyError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  })
  .get("/", async (c) => {
    return c.json(await listAssignments({ tenantId: c.get("tenantId") }));
  });
