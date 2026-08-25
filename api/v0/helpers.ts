/**
 * v0/helpers.ts -- helpers shared by v0 services and routes.
 *
 * References to shared definitions (values, cycles, tax types, taxes) accept
 * an existing id OR the full inline object; inline objects are upserted by
 * their client-provided unique_id, so e.g. defining a plan is always a
 * single request.
 */
import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { z } from "zod";
import { db } from "../db/index.ts";
import { cycles, taxes, taxTypes, values } from "../db/schema.ts";
import type { Award } from "../schemas/coupon.ts";
import { cycleSchema, type Cycle } from "../schemas/cycle.ts";
import {
  cycleIdSchema,
  idSuffixLengths,
  taxIdSchema,
  taxTypeIdSchema,
  valueIdSchema,
  type IdPrefix,
} from "../schemas/ids.ts";
import { taxSchema } from "../schemas/tax.ts";
import { taxTypeSchema, type TaxType } from "../schemas/tax-type.ts";
import { valueSchema, type Value } from "../schemas/value.ts";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * The tenant id path param. Present on every route mounted under
 * /tenants/:id -- throws if somehow absent.
 */
export function tenantParam(c: Context): string {
  const id = c.req.param("id");
  if (!id) {
    throw new Error("missing tenant id path param");
  }
  return id;
}

/** Generate a prefixed id server-side, e.g. for derived entities. */
export function generateId(prefix: IdPrefix): string {
  const length = idSuffixLengths[prefix];
  const bytes = randomBytes(length);
  let suffix = "";
  for (let i = 0; i < length; i++) {
    suffix += ALPHABET[bytes[i] % 36];
  }
  return `${prefix}_${suffix}`;
}

export const valueRefSchema = z.union([valueIdSchema, valueSchema]);
export const cycleRefSchema = z.union([cycleIdSchema, cycleSchema]);
export const taxTypeRefSchema = z.union([taxTypeIdSchema, taxTypeSchema]);
/** A tax reference; an inline tax may itself carry an inline tax type. */
export const taxRefSchema = z.union([
  taxIdSchema,
  z.object({ ...taxSchema.shape, tax_type: taxTypeRefSchema }),
]);

export function valueToRow(value: Value) {
  return {
    uniqueId: value.unique_id,
    createdAt: value.created_at,
    deprecatedAt: value.deprecated_at,
    name: value.name,
    description: value.description,
    amounts: value.amounts,
  };
}

export function cycleToRow(cycle: Cycle) {
  const base = {
    uniqueId: cycle.unique_id,
    createdAt: cycle.created_at,
    deprecatedAt: cycle.deprecated_at,
    name: cycle.name,
    description: cycle.description,
    charged: cycle.charged,
    cycleLength: cycle.cycle_length,
  };
  if (cycle.charged === "upfront") {
    return {
      ...base,
      creditPeriod: null,
      gracePeriod: null,
      dunningSchedule: null,
    };
  }
  return {
    ...base,
    creditPeriod: cycle.credit_period,
    gracePeriod: cycle.grace_period,
    dunningSchedule: cycle.dunning_schedule,
  };
}

export function taxTypeToRow(taxType: TaxType) {
  return {
    uniqueId: taxType.unique_id,
    createdAt: taxType.created_at,
    deprecatedAt: taxType.deprecated_at,
    name: taxType.name,
    description: taxType.description,
  };
}

export async function resolveValueRef(
  ref: z.infer<typeof valueRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(values).values(valueToRow(ref)).onConflictDoNothing();
  return ref.unique_id;
}

export async function resolveCycleRef(
  ref: z.infer<typeof cycleRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(cycles).values(cycleToRow(ref)).onConflictDoNothing();
  return ref.unique_id;
}

export async function resolveTaxTypeRef(
  ref: z.infer<typeof taxTypeRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  await db.insert(taxTypes).values(taxTypeToRow(ref)).onConflictDoNothing();
  return ref.unique_id;
}

export async function resolveTaxRef(
  ref: z.infer<typeof taxRefSchema>,
): Promise<string> {
  if (typeof ref === "string") {
    return ref;
  }
  const taxTypeId = await resolveTaxTypeRef(ref.tax_type);
  await db
    .insert(taxes)
    .values({
      uniqueId: ref.unique_id,
      createdAt: ref.created_at,
      deprecatedAt: ref.deprecated_at,
      taxType: taxTypeId,
      name: ref.name,
      description: ref.description,
    })
    .onConflictDoNothing();
  return ref.unique_id;
}

/** An award whose value (for payout/flat_discount) may be inline. */
export const awardInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("payout"), value: valueRefSchema }),
  z.object({ type: z.literal("flat_discount"), value: valueRefSchema }),
  z.object({
    type: z.literal("percentage_discount"),
    value: z.number().gt(0).lte(100),
  }),
]);
export type AwardInput = z.infer<typeof awardInputSchema>;

export async function resolveAward(award: AwardInput): Promise<Award> {
  if (award.type === "percentage_discount") {
    return award;
  }
  return { type: award.type, value: await resolveValueRef(award.value) };
}
