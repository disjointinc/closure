/**
 * v0/tenant/meter-event/service.ts -- meter event business logic. Events are
 * recorded atomically and idempotently via api/cache/meter/index.ts (the Redis
 * hot path) and flushed to pg in batches. Event-time rule evaluation
 * (microcredits_remaining, microcredits_spent) runs in
 * api/cache/rule/evaluate.ts -- this file is the thin HTTP-facing wrapper.
 */
import {
  type MeterEventPayload,
  recordMeterEvent,
  type RecordedMeterEvent,
} from "../../../cache/meter/index.ts";
import { evaluateMeterEventRules } from "../../../cache/rule/evaluate.ts";
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
