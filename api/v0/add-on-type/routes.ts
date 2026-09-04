/**
 * v0/add-on-type/routes.ts -- HTTP for /v0/add-on-type: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { addOnTypeSchema } from "../../schemas/add-on-type.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";
import { valueSchema } from "../../schemas/value.ts";
import {
  createAddOnType,
  deprecateAddOnType,
  getAddOnType,
  listAddOnTypes,
} from "./service.ts";

// The call surface for prices: an existing cycle id plus the owned value
// inline. Cycles are first-class (referenced by id); values are owned by
// the add-on type, so they're always written and read as full objects.
const addOnTypeApiSchema = addOnTypeSchema.extend({
  prices: z.array(z.object({ cycleId: cycleIdSchema, value: valueSchema })),
});

export type AddOnTypeApi = z.infer<typeof addOnTypeApiSchema>;

export const addOnTypeApp = new Hono()
  .post("/", zValidator("json", addOnTypeApiSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createAddOnType({ addOnType: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listAddOnTypes());
  })
  .get("/:addOnTypeId", async (c) => {
    const addOnType = await getAddOnType({
      addOnTypeId: c.req.param("addOnTypeId"),
    });
    if (!addOnType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOnType);
  })
  .delete("/:addOnTypeId", async (c) => {
    const addOnType = await deprecateAddOnType({
      addOnTypeId: c.req.param("addOnTypeId"),
    });
    if (!addOnType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(addOnType);
  });
