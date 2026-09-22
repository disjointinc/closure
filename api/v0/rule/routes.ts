/**
 * v0/rule/routes.ts -- HTTP for /v0/rule: creation, listing, get, and
 * deprecate. Business logic lives in service.ts.
 *
 * The wire speaks fractional credits and credit-named triggers
 * (credits_remaining / credits_spent, {{balanceCredits}} placeholders);
 * everything internal speaks microcredits. Handlers convert at the
 * boundary -- see api/lib/credits.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../lib/http.ts";
import {
  credits,
  creditsToMicrocredits,
  microcreditsToCredits,
  renameIssueToCredits,
} from "../../lib/credits.ts";
import { durationSchema } from "../../schemas/common.ts";
import { meterIdSchema, ruleIdSchema } from "../../schemas/ids.ts";
import {
  checkRule,
  type Rule,
  type RuleAction,
  type RuleTrigger,
  ruleSchema,
} from "../../schemas/rule.ts";
import { createRule, deprecateRule, getRule, listRules } from "./service.ts";

/** An absolute amount (credits on the wire), or a percentage of allocation. */
const amountOrPercentageWireSchema = z.union([
  z.object({ absolute: credits.nonnegative() }),
  z.object({ percentageOfInitialAllocation: z.number().positive().max(100) }),
]);

/** Fires when the balance remaining crosses (at or below) a value. */
const creditsRemainingTriggerWireSchema = z.object({
  type: z.literal("credits_remaining"),
  meterId: meterIdSchema,
  at: amountOrPercentageWireSchema,
});

/** Fires when cumulative spend crosses (at or above) a value. */
const creditsSpentTriggerWireSchema = z.object({
  type: z.literal("credits_spent"),
  meterId: meterIdSchema,
  at: amountOrPercentageWireSchema,
});

const ruleTriggerWireSchema = z.discriminatedUnion("type", [
  creditsRemainingTriggerWireSchema,
  creditsSpentTriggerWireSchema,
  z.object({
    type: z.literal("inactive_for"),
    meterId: meterIdSchema,
    duration: durationSchema,
  }),
  z.object({
    type: z.literal("relative_to_lifecycle_event"),
    relativeTo: z.enum([
      "invoice_finalized",
      "invoice_due",
      "cycle_end",
      "assignment_started",
    ]),
    offset: durationSchema,
  }),
]);
type RuleTriggerWire = z.infer<typeof ruleTriggerWireSchema>;

/* create_task templates name the firing payload's fields; the wire names
 * them in credits, the engine substitutes the microcredits-named fields. */
const WIRE_PLACEHOLDER_TO_INTERNAL: Record<string, string> = {
  balanceCredits: "balanceMicrocredits",
  spentCredits: "spentMicrocredits",
  thresholdCredits: "thresholdMicrocredits",
};
const INTERNAL_PLACEHOLDER_TO_WIRE: Record<string, string> = Object.fromEntries(
  Object.entries(WIRE_PLACEHOLDER_TO_INTERNAL).map(([wire, internal]) => [
    internal,
    wire,
  ]),
);

function rewritePlaceholders({
  rename,
  template,
}: {
  rename: Record<string, string>;
  template: string;
}): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (match, name: string) => rename[name] ?? match,
  );
}

type AtWire = z.infer<typeof amountOrPercentageWireSchema>;
type AtInternal = Extract<
  RuleTrigger,
  { type: "microcredits_remaining" }
>["at"];

function atToMicrocredits({ at }: { at: AtWire }): AtInternal {
  if ("absolute" in at) {
    return { absolute: creditsToMicrocredits({ credits: at.absolute }) };
  }
  return at;
}

function atToCredits({ at }: { at: AtInternal }): AtWire {
  if ("absolute" in at) {
    return { absolute: microcreditsToCredits({ microcredits: at.absolute }) };
  }
  return at;
}

function triggerToMicrocredits({
  trigger,
}: {
  trigger: RuleTriggerWire;
}): RuleTrigger {
  if (trigger.type === "credits_remaining") {
    return {
      type: "microcredits_remaining",
      meterId: trigger.meterId,
      at: atToMicrocredits({ at: trigger.at }),
    };
  }
  if (trigger.type === "credits_spent") {
    return {
      type: "microcredits_spent",
      meterId: trigger.meterId,
      at: atToMicrocredits({ at: trigger.at }),
    };
  }
  return trigger;
}

function triggerToCredits({
  trigger,
}: {
  trigger: RuleTrigger;
}): RuleTriggerWire {
  if (trigger.type === "microcredits_remaining") {
    return {
      type: "credits_remaining",
      meterId: trigger.meterId,
      at: atToCredits({ at: trigger.at }),
    };
  }
  if (trigger.type === "microcredits_spent") {
    return {
      type: "credits_spent",
      meterId: trigger.meterId,
      at: atToCredits({ at: trigger.at }),
    };
  }
  return trigger;
}

function actionToMicrocredits({ action }: { action: RuleAction }): RuleAction {
  if (action.type !== "create_task") {
    return action;
  }
  return {
    ...action,
    title: rewritePlaceholders({
      rename: WIRE_PLACEHOLDER_TO_INTERNAL,
      template: action.title,
    }),
    description:
      action.description === null
        ? null
        : rewritePlaceholders({
            rename: WIRE_PLACEHOLDER_TO_INTERNAL,
            template: action.description,
          }),
  };
}

function actionToCredits({ action }: { action: RuleAction }): RuleAction {
  if (action.type !== "create_task") {
    return action;
  }
  return {
    ...action,
    title: rewritePlaceholders({
      rename: INTERNAL_PLACEHOLDER_TO_WIRE,
      template: action.title,
    }),
    description:
      action.description === null
        ? null
        : rewritePlaceholders({
            rename: INTERNAL_PLACEHOLDER_TO_WIRE,
            template: action.description,
          }),
  };
}

/**
 * The create-input rule: the server mints ruleId and stamps times. The
 * trigger/actions fields are the internal (microcredits-named) shapes; the
 * wire create schema overrides them with credit-named twins.
 */
export const ruleCreateSchema = z
  .object(ruleSchema.shape)
  .omit({ ruleId: true, createdAt: true, deprecatedAt: true })
  .superRefine((rule, ctx) => checkRule(rule, ctx));
export type RuleCreateBody = z.infer<typeof ruleCreateSchema>;

const ruleCreateWireSchema = z
  .object(ruleSchema.shape)
  .omit({ ruleId: true, createdAt: true, deprecatedAt: true })
  .extend({
    trigger: ruleTriggerWireSchema,
    actions: ruleCreateSchema.shape.actions,
  })
  .superRefine(checkRuleWire);
type RuleCreateWireBody = z.infer<typeof ruleCreateWireSchema>;

/** The rule shape the call surface reads: credit-named and -denominated. */
const ruleWireApiResponseSchema = z.object(ruleSchema.shape).extend({
  trigger: ruleTriggerWireSchema,
  actions: ruleCreateSchema.shape.actions,
});
type RuleWireApi = z.infer<typeof ruleWireApiResponseSchema>;

function ruleCreateToMicrocredits({
  rule,
}: {
  rule: RuleCreateWireBody;
}): RuleCreateBody {
  return {
    ...rule,
    trigger: triggerToMicrocredits({ trigger: rule.trigger }),
    actions: rule.actions.map((action) => actionToMicrocredits({ action })),
  };
}

function ruleApiToCredits({ rule }: { rule: Rule }): RuleWireApi {
  return {
    ...rule,
    trigger: triggerToCredits({ trigger: rule.trigger }),
    actions: rule.actions.map((action) => actionToCredits({ action })),
  };
}

/**
 * checkRule on the wire shape: convert to the internal (microcredits) rule,
 * then rewrite issue names so validation messages read in credits.
 */
function checkRuleWire(rule: RuleCreateWireBody, ctx: z.RefinementCtx): void {
  const internal = ruleCreateToMicrocredits({ rule });
  checkRule(internal, {
    value: internal,
    issues: [],
    addIssue: (issue) => {
      if (typeof issue === "string") {
        ctx.addIssue(issue);
        return;
      }
      ctx.addIssue(renameIssueToCredits({ issue }));
    },
  });
}

const createRuleRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Rule"],
  summary: "Create a rule",
  request: {
    body: {
      content: { "application/json": { schema: ruleCreateWireSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: ruleWireApiResponseSchema } },
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
        "application/json": { schema: z.array(ruleWireApiResponseSchema) },
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
      content: { "application/json": { schema: ruleWireApiResponseSchema } },
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
      content: { "application/json": { schema: ruleWireApiResponseSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const ruleApp = new OpenAPIHono()
  .openapi(createRuleRoute, async (c) => {
    const body = c.req.valid("json");
    const rule = await createRule({
      rule: ruleCreateToMicrocredits({ rule: body }),
    });
    if ("error" in rule) {
      return c.json(rule, 400);
    }
    return c.json(ruleApiToCredits({ rule }), 201);
  })
  .openapi(listRulesRoute, async (c) => {
    const rules = await listRules();
    return c.json(
      rules.map((rule) => ruleApiToCredits({ rule })),
      200,
    );
  })
  .openapi(getRuleRoute, async (c) => {
    const rule = await getRule({ ruleId: c.req.param("ruleId") });
    if (!rule) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(ruleApiToCredits({ rule }), 200);
  })
  .openapi(deprecateRuleRoute, async (c) => {
    const rule = await deprecateRule({ ruleId: c.req.param("ruleId") });
    if (!rule) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(ruleApiToCredits({ rule }), 200);
  });
