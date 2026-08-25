/**
 * v0/tenant/meter-event/service.ts -- meter event business logic. Events are
 * recorded atomically and idempotently via api/cache/metering.ts (the Redis
 * hot path) and flushed to pg in batches; the list reads the pg audit log.
 */
import { desc, eq } from "drizzle-orm";
import {
  recordMeterEvent,
  type RecordedMeterEvent,
} from "../../../cache/metering.ts";
import { db } from "../../../db/index.ts";
import { meterEvents } from "../../../db/schema.ts";
import type { MeterEventCreateBody } from "./routes.ts";

export async function recordEvent({
  event,
  tenantId,
}: {
  event: MeterEventCreateBody;
  tenantId: string;
}): Promise<RecordedMeterEvent> {
  return recordMeterEvent({ event: { ...event, tenant: tenantId } });
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
    .where(eq(meterEvents.tenant, tenantId))
    .orderBy(desc(meterEvents.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    unique_id: row.uniqueId,
    unique_external_id: row.uniqueExternalId,
    created_at: row.createdAt,
    meter: row.meter,
    tenant: row.tenant,
    amount: row.amountMicrocredits,
    status: row.status,
  }));
}
