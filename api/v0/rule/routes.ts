/**
 * v0/rule/routes.ts -- HTTP for /v0/rule: creation, listing, get, and
 * deprecate. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../lib/http.ts";
import { ruleIdSchema } from "../../schemas/ids.ts";
import { ruleSchema } from "../../schemas/rule.ts";
import {
  createRule,
  deprecateRule,
  getRule,
  listRules,
  ruleApiSchema,
} from "./service.ts";

const ruleApiResponseSchema = z
  .object(ruleSchema.shape)
  .extend({ actions: ruleApiSchema.shape.actions });

const createRuleRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Rule"],
  summary: "Create a rule",
  request: {
    body: {
      content: { "application/json": { schema: ruleApiSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: ruleApiResponseSchema } },
      description: "Created",
    },
    400: invalidResponse,
  },
});

const listRulesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Rule"],
  summary: "List rules",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.array(ruleApiResponseSchema) },
      },
      description: "OK",
    },
  },
});

const getRuleRoute = createRoute({
  method: "get",
  path: "/{ruleId}",
  tags: ["Rule"],
  summary: "Get a rule",
  request: { params: z.object({ ruleId: ruleIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: ruleApiResponseSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deprecateRuleRoute = createRoute({
  method: "delete",
  path: "/{ruleId}",
  tags: ["Rule"],
  summary: "Deprecate a rule",
  request: { params: z.object({ ruleId: ruleIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: ruleApiResponseSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const ruleApp = new OpenAPIHono()
  .openapi(createRuleRoute, async (c) => {
    const body = c.req.valid("json");
    const rule = await createRule({ rule: body });
    if ("error" in rule) {
      return c.json(rule, 400);
    }
    return c.json(rule, 201);
  })
  .openapi(listRulesRoute, async (c) => {
    return c.json(await listRules(), 200);
  })
  .openapi(getRuleRoute, async (c) => {
    const rule = await getRule({ ruleId: c.req.param("ruleId") });
    if (!rule) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(rule, 200);
  })
  .openapi(deprecateRuleRoute, async (c) => {
    const rule = await deprecateRule({ ruleId: c.req.param("ruleId") });
    if (!rule) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(rule, 200);
  });
