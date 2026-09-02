/**
 * cache/test_helpers.ts -- shared fixtures for the cache integration tests.
 * Both test files run against the same scratch Postgres + throwaway Redis;
 * api/vitest.config.ts runs files sequentially because they share that
 * external state (a FLUSHALL must never race another file).
 */
import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { config } from "../../config.ts";
import { db } from "../db/index.ts";
import {
  meterBalances,
  meterEvents,
  meters,
  rules,
  teamMembers,
  tenants,
} from "../db/schema.ts";
import type { Rule } from "../schemas/rule.ts";
import { redis } from "./index.ts";
import type { MeterEventPayload } from "./meter/metering.ts";

export function suffix({ length }: { length: number }): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}

export const newTenantId = () => `tenant_${suffix({ length: 22 })}`;
export const newMeterId = () => `meter_${suffix({ length: 20 })}`;
export const newMeterEventId = () => `meter_event_${suffix({ length: 37 })}`;
export const newCreditGrantId = () => `credit_grant_${suffix({ length: 25 })}`;
export const newRuleId = () => `rule_${suffix({ length: 20 })}`;
export const newTaskTypeId = () => `task_type_${suffix({ length: 20 })}`;

export async function makeTenant({
  tenantId,
}: { tenantId?: string } = {}): Promise<string> {
  const resolvedTenantId = tenantId ?? newTenantId();
  await db.insert(tenants).values({
    tenantId: resolvedTenantId,
    createdAt: Date.now(),
    deletedAt: null,
    externalIds: {},
  });
  return resolvedTenantId;
}

export async function makeMeter({
  meterId,
}: { meterId?: string } = {}): Promise<string> {
  const resolvedMeterId = meterId ?? newMeterId();
  await db.insert(meters).values({
    meterId: resolvedMeterId,
    createdAt: Date.now(),
    deprecatedAt: null,
    name: "Test meter",
    description: null,
  });
  return resolvedMeterId;
}

export async function makeTeamMember(): Promise<string> {
  const teamMemberId = `team_member_${suffix({ length: 16 })}`;
  await db.insert(teamMembers).values({
    teamMemberId,
    email: `${teamMemberId}@test.invalid`,
    name: null,
    profilePictureUrl: null,
  });
  return teamMemberId;
}

/** Insert a rule directly (bypassing the API) for evaluation tests. */
export async function makeRule({
  rule,
}: {
  rule: Omit<Rule, "ruleId" | "createdAt" | "deprecatedAt"> &
    Partial<Pick<Rule, "ruleId" | "createdAt" | "deprecatedAt">>;
}): Promise<string> {
  const ruleId = rule.ruleId ?? newRuleId();
  await db.insert(rules).values({
    ruleId,
    createdAt: rule.createdAt ?? Date.now(),
    deprecatedAt: rule.deprecatedAt ?? null,
    scope: rule.scope,
    trigger: rule.trigger,
    recurrence: rule.recurrence,
    actions: rule.actions,
    name: rule.name,
    description: rule.description,
  });
  return ruleId;
}

export function makeEvent({
  amountMicrocredits,
  meterId,
  overrides,
  tenantId,
}: {
  amountMicrocredits: number;
  meterId: string;
  overrides?: Partial<MeterEventPayload>;
  tenantId: string;
}): MeterEventPayload {
  return {
    meterEventId: newMeterEventId(),
    externalId: `ext-${suffix({ length: 16 })}`,
    createdAt: Date.now(),
    meterId,
    tenantId,
    amountMicrocredits,
    ...overrides,
  };
}

export async function pgEventCount({
  tenantId,
}: {
  tenantId: string;
}): Promise<number> {
  const rows = await db
    .select({ meterEventId: meterEvents.meterEventId })
    .from(meterEvents)
    .where(eq(meterEvents.tenantId, tenantId));
  return rows.length;
}

export async function pgCheckpoint({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}) {
  const [row] = await db
    .select()
    .from(meterBalances)
    .where(
      and(
        eq(meterBalances.tenantId, tenantId),
        eq(meterBalances.meterId, meterId),
      ),
    );
  return row;
}

/**
 * Guard + reset shared by both test files: refuse to run against anything
 * but a local throwaway Redis, then FLUSHALL so every run starts clean
 * Redis-side. (The scratch pg database persists fixtures across runs.)
 */
export async function resetTestState(): Promise<void> {
  if (process.env.CLOSURE_TEST_ALLOW_DESTRUCTIVE !== "1") {
    throw new Error(
      "set CLOSURE_TEST_ALLOW_DESTRUCTIVE=1 (tests FLUSHALL Redis)",
    );
  }
  if (!["localhost", "127.0.0.1"].includes(config.redis.host)) {
    throw new Error("tests must run against a local, throwaway Redis");
  }
  await redis.ping();
  await db.execute(sql`select 1`);
  await redis.flushall();
}

export async function closeTestState(): Promise<void> {
  redis.quit();
  await db.$client.end();
}
