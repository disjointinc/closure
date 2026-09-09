/**
 * v0/add-on-type/routes.ts -- HTTP for /v0/add-on-type: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { addOnTypeSchema } from "../../schemas/add-on-type.ts";
import { cycleIdSchema } from "../../schemas/ids.ts";
import { valueCreateSchema, valueSchema } from "../../schemas/value.ts";
import {
  createAddOnType,
  deprecateAddOnType,
  getAddOnType,
  listAddOnTypes,
} from "./service.ts";

// The call surface for prices: an existing cycle id plus the owned value
// inline. Cycles are first-class (referenced by id); values are owned by
// the add-on type, so they're always written and read as full objects.
export const addOnTypeApiSchema = addOnTypeSchema.extend({
  prices: z.array(z.object({ cycleId: cycleIdSchema, value: valueSchema })),
});

export type AddOnTypeApi = z.infer<typeof addOnTypeApiSchema>;

/** Create-input: the server mints the add-on type and value ids and stamps times. */
const addOnTypeCreateSchema = addOnTypeSchema
  .omit({ addOnTypeId: true, createdAt: true, deprecatedAt: true })
  .extend({
    prices: z.array(
      z.object({ cycleId: cycleIdSchema, value: valueCreateSchema }),
    ),
  });

export type AddOnTypeCreateBody = z.infer<typeof addOnTypeCreateSchema>;

export const addOnTypeApp = new Hono()
  .post("/", zValidator("json", addOnTypeCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const addOnType = await createAddOnType({ addOnType: body });
    if ("error" in addOnType) {
      return c.json(addOnType, 400);
    }
    return c.json(addOnType, 201);
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
