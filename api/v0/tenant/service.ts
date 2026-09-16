/**
 * v0/tenant/service.ts -- tenant business logic: tenant CRUD (soft delete).
 * Resolved entitlements live in feature-entitlements/ and
 * meter-entitlements/.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { tenants } from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { TenantCreateBody, TenantPatchBody } from "./routes.ts";

export async function getTenant({ tenantId }: { tenantId: string }) {
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.tenantId, tenantId));
  return row ?? null;
}

export async function listTenants() {
  return db.select().from(tenants);
}

export async function createTenant({ tenant }: { tenant: TenantCreateBody }) {
  const tenantId = generateId({ prefix: "tenant" });
  const createdAt = Date.now();
  await db
    .insert(tenants)
    .values({
      tenantId,
      createdAt,
      deletedAt: null,
      externalIds: tenant.externalIds,
    })
    .onConflictDoNothing();
  return { ...tenant, tenantId, createdAt, deletedAt: null };
}

/** Patch the tenant, or return null if no such tenant exists. */
export async function patchTenant({
  patch,
  tenantId,
}: {
  patch: TenantPatchBody;
  tenantId: string;
}) {
  const updated = await db
    .update(tenants)
    .set({ externalIds: patch.externalIds })
    .where(eq(tenants.tenantId, tenantId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return updated[0];
}

/** Soft-delete the tenant, or return null if no such tenant exists. */
export async function deleteTenant({ tenantId }: { tenantId: string }) {
  const updated = await db
    .update(tenants)
    .set({ deletedAt: Date.now() })
    .where(eq(tenants.tenantId, tenantId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return updated[0];
}
