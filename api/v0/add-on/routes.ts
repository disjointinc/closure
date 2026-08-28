/**
 * v0/add-on/routes.ts -- HTTP for /v0/add-on: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { addOnSchema } from "../../schemas/add-on.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";
import { valueSchema } from "../../schemas/value.ts";
import {
  createAddOn,
  deprecateAddOn,
  getAddOn,
  listAddOns,
} from "./service.ts";

// Prices reference existing cycles by id; values are always defined inline.
const addOnCreateSchema = z.object({
  ...addOnSchema.shape,
  prices: z.array(z.object({ cycleId: cycleIdSchema, value: valueSchema })),
});

export type AddOnCreateBody = z.infer<typeof addOnCreateSchema>;

export const addOnApp = new Hono()
  .post("/", zValidator("json", addOnCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createAddOn({ addOn: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listAddOns());
  })
  .get("/:addOnId", async (c) => {
    const addOn = await getAddOn({ addOnId: c.req.param("addOnId") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn);
  })
  .delete("/:addOnId", async (c) => {
    const addOn = await deprecateAddOn({ addOnId: c.req.param("addOnId") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn);
  });
