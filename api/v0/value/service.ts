/**
 * v0/values/service.ts -- value business logic. Values have no route of
 * their own: they're shared definitions composed into other resources,
 * referenced by id or defined inline (upserted by their client-provided
 * unique_id).
 */
import { z } from "zod";
import { db } from "../../db/index.ts";
import { values } from "../../db/schema.ts";
import { valueIdSchema } from "../../schemas/ids.ts";
import { valueSchema, type Value } from "../../schemas/value.ts";

/** A value reference: an existing id or the full inline object. */
export const valueRefSchema = z.union([valueIdSchema, valueSchema]);

function valueToRow(value: Value) {
  return {
    uniqueId: value.unique_id,
    createdAt: value.created_at,
    deprecatedAt: value.deprecated_at,
    name: value.name,
    description: value.description,
    amounts: value.amounts,
  };
}

function rowToValue(row: typeof values.$inferSelect): Value {
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    deprecated_at: row.deprecatedAt,
    name: row.name,
    description: row.description,
    amounts: row.amounts,
  };
}

export async function listValues(): Promise<Value[]> {
  const rows = await db.select().from(values);
  return rows.map(rowToValue);
}

/** Resolve a value reference to an id, upserting inline definitions. */
export async function resolveValueRef(
  ref: z.infer<typeof valueRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(values).values(valueToRow(ref)).onConflictDoNothing();
  return ref.unique_id;
}
