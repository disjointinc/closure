/**
 * v0/tenant/add-on/routes.ts -- HTTP for /v0/tenant/:tenantId/add-on: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../../schemas/common.ts";
import { addOnTypeIdSchema } from "../../../schemas/ids.ts";
import { attachAddOn, deleteAddOn, getAddOn, listAddOns } from "./service.ts";

/** The attach targets the tenant's open assignment, inferred from the path. */
const addOnCreateSchema = z.object({
  addOnTypeId: addOnTypeIdSchema,
  startsAt: epochMs.nullable(),
  endsAt: epochMs.nullable(),
});

export type AddOnCreateBody = z.infer<typeof addOnCreateSchema>;

export const addOnApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", addOnCreateSchema), async (c) => {
    const addOn = await attachAddOn({
      addOn: c.req.valid("json"),
      tenantId: c.get("tenantId"),
    });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn, 201);
  })
  .get("/", async (c) => {
    return c.json(await listAddOns({ tenantId: c.get("tenantId") }));
  })
  .get("/:addOnId", async (c) => {
    const addOn = await getAddOn({ addOnId: c.req.param("addOnId") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn);
  })
  .delete("/:addOnId", async (c) => {
    const addOn = await deleteAddOn({ addOnId: c.req.param("addOnId") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn);
  });
