/**
 * v0/tenant/assignment/routes.ts -- HTTP for /v0/tenant/:id/assignment: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { assignmentSchema } from "../../../schemas/assignment.ts";
import { epochMs } from "../../../schemas/common.ts";
import { addOnIdSchema } from "../../../schemas/ids.ts";
import { attachAddOn, createAssignment, listAssignments } from "./service.ts";

const addOnAttachSchema = z.object({
  add_on: addOnIdSchema,
  start: epochMs,
  end: epochMs.nullable(),
});

export type AddOnAttachBody = z.infer<typeof addOnAttachSchema>;

export const assignmentApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", assignmentSchema), async (c) => {
    const tenantId = c.get("tenantId");
    const body = c.req.valid("json");
    return c.json(await createAssignment({ assignment: body, tenantId }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listAssignments({ tenantId: c.get("tenantId") }));
  })
  .post(
    "/:assignment_id/add-ons",
    zValidator("json", addOnAttachSchema),
    async (c) => {
      const assignment = await attachAddOn({
        addOn: c.req.valid("json"),
        assignmentId: c.req.param("assignment_id"),
      });
      if (!assignment) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(assignment, 201);
    },
  );
