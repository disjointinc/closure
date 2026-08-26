/**
 * v0/values/service.ts -- value business logic. Values have no route of
 * their own: they're shared definitions composed into other resources,
 * referenced by id or defined inline (upserted by their client-provided
 * uniqueId).
 */
import { z } from "zod";
import { db } from "../../db/index.ts";
import { values } from "../../db/schema.ts";
import { valueIdSchema } from "../../schemas/ids.ts";
import { valueSchema, type Value } from "../../schemas/value.ts";

/** A value reference: an existing id or the full inline object. */
export const valueRefSchema = z.union([valueIdSchema, valueSchema]);

export async function listValues(): Promise<Value[]> {
  return db.select().from(values);
}

/** Resolve a value reference to an id, upserting inline definitions. */
export async function resolveValueRef(
  ref: z.infer<typeof valueRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(values).values(ref).onConflictDoNothing();
  return ref.uniqueId;
}
