/**
 * v0/tenant/meter-event/service.ts -- meter event business logic. Events are
 * recorded atomically and idempotently via api/cache/meter/index.ts (the Redis
 * hot path) and flushed to pg in batches; the list reads the pg audit log.
 * Event-time rule evaluation (microcredits_remaining, microcredits_spent)
 * runs in api/cache/rule/evaluate.ts -- this file is the thin HTTP-facing
 * wrapper.
 */
import { desc, eq } from "drizzle-orm";
import {
  type MeterEventPayload,
  recordMeterEvent,
  type RecordedMeterEvent,
} from "../../../cache/meter/index.ts";
import { evaluateMeterEventRules } from "../../../cache/rule/evaluate.ts";
import { db } from "../../../db/index.ts";
import { meterEvents } from "../../../db/schema.ts";
import { generateId } from "../../../lib/id.ts";
import type { MeterEventCreateBody } from "./routes.ts";

export async function recordEvent({
  event,
  tenantId,
}: {
  event: MeterEventCreateBody;
  tenantId: string;
}): Promise<RecordedMeterEvent & { event: MeterEventPayload }> {
  const payload: MeterEventPayload = {
    ...event,
    meterEventId: generateId({ prefix: "meter_event" }),
    createdAt: Date.now(),
    tenantId,
  };
  const recorded = await recordMeterEvent({ event: payload });
  // Event-time rules (microcredits_remaining, microcredits_spent) evaluate
  // against the post-decision balance. Failure to evaluate never fails the
  // metering write: log and let the event's own response through.
  try {
    await evaluateMeterEventRules({
      event: {
        amountMicrocredits: payload.amountMicrocredits,
        balanceMicrocredits: recorded.balanceMicrocredits,
        externalId: payload.externalId ?? payload.meterEventId,
        meterId: payload.meterId,
        status: recorded.status,
        tenantId,
      },
    });
  } catch (error) {
    console.error("rule evaluation failed for meter event", {
      error,
      meterId: payload.meterId,
      tenantId,
    });
  }
  return { ...recorded, event: payload };
}

export async function listMeterEvents({
  limit,
  tenantId,
}: {
  limit: number;
  tenantId: string;
}) {
  const rows = await db
    .select()
    .from(meterEvents)
    .where(eq(meterEvents.tenantId, tenantId))
    .orderBy(desc(meterEvents.createdAt))
    .limit(limit);
  // receivedAtMicros (reconciler state) stays out of the wire shape.
  return rows.map((row) => ({
    meterEventId: row.meterEventId,
    externalId: row.externalId,
    createdAt: row.createdAt,
    meterId: row.meterId,
    tenantId: row.tenantId,
    amountMicrocredits: row.amountMicrocredits,
    status: row.status,
  }));
}
