/**
 * v0/assignments/routes.ts -- HTTP for /v0/tenants/:id/assignments: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { assignmentSchema } from "../../schemas/assignment.ts";
import { epochMs } from "../../schemas/common.ts";
import { addOnIdSchema } from "../../schemas/ids.ts";
import { tenantParam } from "../helpers.ts";
import { attachAddOn, createAssignment, listAssignments } from "./service.ts";

const addOnAttachSchema = z.object({
  add_on: addOnIdSchema,
  start: epochMs,
  end: epochMs.nullable(),
});

export type AddOnAttachBody = z.infer<typeof addOnAttachSchema>;

export const assignmentsApp = new Hono()
  .post("/", zValidator("json", assignmentSchema), async (c) => {
    const tenantId = tenantParam(c);
    const body = c.req.valid("json");
    return c.json(await createAssignment({ assignment: body, tenantId }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listAssignments({ tenantId: tenantParam(c) }));
  })
  .post("/:aid/add-ons", zValidator("json", addOnAttachSchema), async (c) => {
    const assignment = await attachAddOn({
      addOn: c.req.valid("json"),
      assignmentId: c.req.param("aid"),
    });
    if (!assignment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(assignment, 201);
  });
