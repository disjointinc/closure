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
  teamMembers,
  tenants,
} from "../db/schema.ts";
import { redis } from "./index.ts";
import type { MeterEventPayload } from "./metering.ts";

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

export async function makeTenant({
  tenantId,
}: { tenantId?: string } = {}): Promise<string> {
  const uniqueId = tenantId ?? newTenantId();
  await db.insert(tenants).values({
    uniqueId,
    createdAt: Date.now(),
    deletedAt: null,
    externalIds: {},
  });
  return uniqueId;
}

export async function makeMeter({
  meterId,
}: { meterId?: string } = {}): Promise<string> {
  const uniqueId = meterId ?? newMeterId();
  await db.insert(meters).values({
    uniqueId,
    createdAt: Date.now(),
    deprecatedAt: null,
    name: "Test meter",
    description: null,
  });
  return uniqueId;
}

export async function makeTeamMember(): Promise<string> {
  const uniqueId = `team_member_${suffix({ length: 16 })}`;
  await db.insert(teamMembers).values({
    uniqueId,
    emailAddress: `${uniqueId}@test.invalid`,
    name: null,
    profilePictureLink: null,
  });
  return uniqueId;
}

export function makeEvent({
  amount,
  meter,
  overrides,
  tenant,
}: {
  amount: number;
  meter: string;
  overrides?: Partial<MeterEventPayload>;
  tenant: string;
}): MeterEventPayload {
  return {
    uniqueId: newMeterEventId(),
    uniqueExternalId: `ext-${suffix({ length: 16 })}`,
    createdAt: Date.now(),
    meter,
    tenant,
    amount,
    ...overrides,
  };
}

export async function pgEventCount({
  tenant,
}: {
  tenant: string;
}): Promise<number> {
  const rows = await db
    .select({ uniqueId: meterEvents.uniqueId })
    .from(meterEvents)
    .where(eq(meterEvents.tenant, tenant));
  return rows.length;
}

export async function pgCheckpoint({
  meter,
  tenant,
}: {
  meter: string;
  tenant: string;
}) {
  const [row] = await db
    .select()
    .from(meterBalances)
    .where(
      and(eq(meterBalances.tenant, tenant), eq(meterBalances.meter, meter)),
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
