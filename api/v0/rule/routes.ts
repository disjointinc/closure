/**
 * v0/rule/routes.ts -- HTTP for /v0/rule: creation, listing, get, and
 * deprecate. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  createRule,
  deprecateRule,
  getRule,
  listRules,
  ruleApiSchema,
} from "./service.ts";

export const ruleApp = new Hono()
  .post("/", zValidator("json", ruleApiSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createRule({ rule: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listRules());
  })
  .get("/:ruleId", async (c) => {
    const rule = await getRule({ ruleId: c.req.param("ruleId") });
    if (!rule) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(rule);
  })
  .delete("/:ruleId", async (c) => {
    const rule = await deprecateRule({ ruleId: c.req.param("ruleId") });
    if (!rule) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(rule);
  });
