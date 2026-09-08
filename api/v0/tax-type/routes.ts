/**
 * v0/tax-type/routes.ts -- HTTP for /v0/tax-type: creation, listing, get,
 * and deprecate. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  createTaxType,
  deprecateTaxType,
  getTaxType,
  listTaxTypes,
  taxTypeCreateSchema,
} from "./service.ts";

export const taxTypeApp = new Hono()
  .post("/", zValidator("json", taxTypeCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTaxType({ taxType: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listTaxTypes());
  })
  .get("/:taxTypeId", async (c) => {
    const taxType = await getTaxType({ taxTypeId: c.req.param("taxTypeId") });
    if (!taxType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taxType);
  })
  .delete("/:taxTypeId", async (c) => {
    const taxType = await deprecateTaxType({
      taxTypeId: c.req.param("taxTypeId"),
    });
    if (!taxType) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(taxType);
  });
