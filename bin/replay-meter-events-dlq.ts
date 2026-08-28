/**
 * bin/replay-meter-events-dlq.ts -- re-drive dead-lettered meter events into
 * meter_events after the root cause (e.g. a missing meter row) is fixed.
 *
 * Rows are inserted idempotently (the (tenantId, meterId, externalId)
 * unique index + ON CONFLICT DO NOTHING) and deleted from the DLQ once
 * meterEvents holds them. Rows whose payload never parsed (null extracted
 * columns) are left in place for manual inspection.
 *
 * Run from the repo root: node bin/replay-meter-events-dlq.ts
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../api/db/index.ts";
import { meterEvents, meterEventsDlq } from "../api/db/schema.ts";

type DlqRow = typeof meterEventsDlq.$inferSelect;

type ReplayableRow = DlqRow & {
  tenantId: string;
  meterId: string;
  amountMicrocredits: number;
  status: NonNullable<DlqRow["status"]>;
};

function isReplayable(row: DlqRow): row is ReplayableRow {
  return (
    row.tenantId !== null &&
    row.meterId !== null &&
    row.amountMicrocredits !== null &&
    row.status !== null
  );
}

const rows = await db.select().from(meterEventsDlq);

let replayed = 0;
for (const row of rows.filter(isReplayable)) {
  const parsed: {
    meterEventId: string;
    createdAt: number;
    externalId?: string;
  } = JSON.parse(row.payload);
  await db
    .insert(meterEvents)
    .values({
      meterEventId: parsed.meterEventId,
      externalId: parsed.externalId ?? parsed.meterEventId,
      createdAt: parsed.createdAt,
      receivedAtMicros: row.receivedAtMicros,
      meterId: row.meterId,
      tenantId: row.tenantId,
      amountMicrocredits: row.amountMicrocredits,
      status: row.status,
    })
    .onConflictDoNothing();
  await db
    .delete(meterEventsDlq)
    .where(eq(meterEventsDlq.meterEventDlqId, row.meterEventDlqId));
  replayed += 1;
}

const [{ remaining }] = await db
  .select({ remaining: sql<string>`count(*)::bigint` })
  .from(meterEventsDlq);
console.log(`replayed ${replayed} DLQ row(s); ${remaining} remain`);
process.exit(0);
