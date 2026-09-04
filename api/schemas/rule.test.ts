/**
 * schemas/rule.test.ts -- unit tests for rule write-time validation:
 * create_task templates may only use {{placeholder}}s their trigger supplies
 * (checkRule), and rearmOnRecover is only meaningful on metering triggers.
 */
import { describe, expect, it } from "vitest";
import { ruleSchema } from "./rule.ts";

const base = {
  ruleId: "rule_abcdefghijklmnopqrst",
  createdAt: Date.now(),
  deprecatedAt: null,
  scope: { kind: "global" } as const,
  recurrence: {
    window: null,
    rearmOnRecover: false,
    limitRecurrences: 1,
  } as const,
  name: "test rule",
  description: null,
};

const remainingTrigger = {
  type: "microcredits_remaining",
  meterId: "meter_abcdefghijklmnopqrst",
  at: { absolute: 1000 },
} as const;

describe("rule schema template validation", () => {
  it("accepts a microcredits_remaining rule using its placeholders", () => {
    const result = ruleSchema.safeParse({
      ...base,
      trigger: remainingTrigger,
      actions: [
        {
          type: "create_task",
          taskTypeId: "task_type_abcdefghijklmnopqrst",
          title:
            "{{tenantId}} hit {{thresholdMicrocredits}} (balance {{balanceMicrocredits}})",
          description: "meter {{meterId}}",
          assignToTeamMemberId: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a microcredits_spent rule using a remaining-only placeholder", () => {
    const result = ruleSchema.safeParse({
      ...base,
      trigger: {
        type: "microcredits_spent",
        meterId: "meter_abcdefghijklmnopqrst",
        at: { absolute: 1000 },
      },
      actions: [
        {
          type: "create_task",
          taskTypeId: "task_type_abcdefghijklmnopqrst",
          title: "balance {{balanceMicrocredits}}",
          description: null,
          assignToTeamMemberId: null,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("balanceMicrocredits");
    }
  });

  it("rejects an unknown placeholder", () => {
    const result = ruleSchema.safeParse({
      ...base,
      trigger: remainingTrigger,
      actions: [
        {
          type: "create_task",
          taskTypeId: "task_type_abcdefghijklmnopqrst",
          title: "{{nonsense}}",
          description: null,
          assignToTeamMemberId: null,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("ignores non-create_task actions", () => {
    const result = ruleSchema.safeParse({
      ...base,
      trigger: remainingTrigger,
      actions: [{ type: "retry_payment", notes: "retry it" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects rearmOnRecover on a lifecycle trigger", () => {
    const result = ruleSchema.safeParse({
      ...base,
      recurrence: {
        window: null,
        rearmOnRecover: true,
        limitRecurrences: null,
      },
      trigger: {
        type: "relative_to_lifecycle_event",
        relativeTo: "invoice_due",
        offset: { days: 3, months: null },
      },
      actions: [{ type: "retry_payment", notes: "retry it" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("rearmOnRecover");
    }
  });
});
