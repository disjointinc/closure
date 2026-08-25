/**
 * v0/add-ons/routes.ts -- HTTP for /v0/add-ons: request validation and
 * wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { addOnSchema } from "../../schemas/add-on.ts";
import { cycleRefSchema } from "../cycles/service.ts";
import { valueRefSchema } from "../values/service.ts";
import {
  createAddOn,
  deprecateAddOn,
  getAddOn,
  listAddOns,
} from "./service.ts";

const addOnCreateSchema = z.object({
  ...addOnSchema.shape,
  prices: z.array(z.object({ cycle: cycleRefSchema, value: valueRefSchema })),
});

export type AddOnCreateBody = z.infer<typeof addOnCreateSchema>;

export const addOnsApp = new Hono()
  .post("/", zValidator("json", addOnCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createAddOn({ addOn: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listAddOns());
  })
  .get("/:id", async (c) => {
    const addOn = await getAddOn({ uniqueId: c.req.param("id") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn);
  })
  .delete("/:id", async (c) => {
    const addOn = await deprecateAddOn({ uniqueId: c.req.param("id") });
    if (!addOn) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOn);
  });
