/**
 * bin/replay-meter-events-dlq.ts -- re-drive dead-lettered meter events into
 * meter_events after the root cause (e.g. a missing meter row) is fixed.
 *
 * Rows are inserted idempotently (the (tenantId, meterId, externalId)
 * unique index + ON CONFLICT DO NOTHING) and deleted from the DLQ once
 * meterEvents holds them. Rows missing an extracted column (a payload that
 * never parsed, or a stream entry without a received time or balance) are
 * left in place for manual inspection.
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
  balanceAfterMicrocredits: number;
  receivedAtMicroseconds: number;
  status: NonNullable<DlqRow["status"]>;
};

function isReplayable(row: DlqRow): row is ReplayableRow {
  return (
    row.tenantId !== null &&
    row.meterId !== null &&
    row.amountMicrocredits !== null &&
    row.balanceAfterMicrocredits !== null &&
    row.receivedAtMicroseconds !== null &&
    row.status !== null
  );
}

/*
 * One query reads the whole DLQ. That holds up at any realistic size
 * (measured locally, with rows shaped like real DLQ rows):
 *
 *   - Read speed: ~230k rows/s, linear in row count.
 *   - Memory: ~1.3KB of heap per row, so Node's default heap (~4.5GB) runs
 *     out around 3.5M rows.
 *   - Time: STATEMENT_TIMEOUT_MS (api/db/index.ts) would cut the read off
 *     around 7M rows. Memory runs out first locally; a remote database reads
 *     slower, so in production the timeout may come first, but still at
 *     millions of rows.
 *   - Growth: a row only lands here when Postgres rejects its insert (a down
 *     database leaves events buffered in Redis), and each poisoned flush
 *     batch waits out FLUSH_RETRY_BACKOFF_MS before moving its
 *     FLUSH_BATCH_SIZE rows here. That caps growth near 400 rows/s, so 3.5M
 *     rows takes ~2.4 hours of every meter event failing, with flush errors
 *     logged the whole time.
 *
 * If it ever gets that big, page through it by meter_event_dlq_id.
 */
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
      receivedAtMicroseconds: row.receivedAtMicroseconds,
      meterId: row.meterId,
      tenantId: row.tenantId,
      amountMicrocredits: row.amountMicrocredits,
      status: row.status,
      balanceAfterMicrocredits: row.balanceAfterMicrocredits,
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
