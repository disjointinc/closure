/**
 * bin/replay-meter-events-dlq.ts -- re-drive dead-lettered meter events into
 * meter_events after the root cause (e.g. a missing meter row) is fixed.
 *
 * Rows are inserted idempotently (the (tenant, meter, external_id) unique
 * index + ON CONFLICT DO NOTHING) and deleted from the DLQ once meter_events
 * holds them. Rows whose payload never parsed (null extracted columns) are
 * left in place for manual inspection.
 *
 * Run from the repo root: node bin/replay-meter-events-dlq.ts
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../api/db/index.ts";
import { meterEvents, meterEventsDlq } from "../api/db/schema.ts";

type DlqRow = typeof meterEventsDlq.$inferSelect;

type ReplayableRow = DlqRow & {
  tenant: string;
  meter: string;
  amountMicrocredits: number;
  status: NonNullable<DlqRow["status"]>;
};

function isReplayable(row: DlqRow): row is ReplayableRow {
  return (
    row.tenant !== null &&
    row.meter !== null &&
    row.amountMicrocredits !== null &&
    row.status !== null
  );
}

const rows = await db.select().from(meterEventsDlq);

let replayed = 0;
for (const row of rows.filter(isReplayable)) {
  const parsed: {
    unique_id: string;
    created_at: number;
    unique_external_id?: string;
    /** Entries dead-lettered before the field was renamed carry the old name. */
    ideally_unique_external_id?: string;
  } = JSON.parse(row.payload);
  const uniqueExternalId =
    parsed.unique_external_id ??
    parsed.ideally_unique_external_id ??
    parsed.unique_id;
  await db
    .insert(meterEvents)
    .values({
      uniqueId: parsed.unique_id,
      uniqueExternalId,
      createdAt: parsed.created_at,
      receivedAt: row.receivedAt,
      meter: row.meter,
      tenant: row.tenant,
      amountMicrocredits: row.amountMicrocredits,
      status: row.status,
    })
    .onConflictDoNothing();
  await db.delete(meterEventsDlq).where(eq(meterEventsDlq.id, row.id));
  replayed += 1;
}

const [{ remaining }] = await db
  .select({ remaining: sql<string>`count(*)::bigint` })
  .from(meterEventsDlq);
console.log(`replayed ${replayed} DLQ row(s); ${remaining} remain`);
process.exit(0);
