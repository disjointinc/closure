/**
 * v0/tenants/routes.ts -- HTTP for /v0/tenants: request validation, wiring,
 * and the mount points for all tenant-scoped resources (each lives in its
 * own sibling folder). Business logic lives in service.ts.
 *
 * The /:id/* middleware hands the tenant id to mounted sub-routers as a
 * typed context variable (c.get("tenantId")): Hono can't statically type a
 * param declared by a parent mount, and per-handler guards were noise.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../schemas/common.ts";
import { tenantIdSchema } from "../../schemas/ids.ts";
import { assignmentsApp } from "../assignments/routes.ts";
import { couponGrantsApp } from "../coupon-grants/routes.ts";
import { couponReceiptsApp } from "../coupon-receipts/routes.ts";
import { creditGrantsApp } from "../credit-grants/routes.ts";
import { featureOverridesApp } from "../feature-overrides/routes.ts";
import { invoicesApp } from "../invoices/routes.ts";
import { meterBalancesApp } from "../meter-balances/routes.ts";
import { meterEventsApp } from "../meter-events/routes.ts";
import { meterOverridesApp } from "../meter-overrides/routes.ts";
import { paymentMethodsApp } from "../payment-methods/routes.ts";
import { paymentsApp } from "../payments/routes.ts";
import { refundsApp } from "../refunds/routes.ts";
import {
  createTenant,
  deleteTenant,
  getEntitlements,
  getTenant,
  listTenants,
  patchTenant,
} from "./service.ts";

const tenantCreateSchema = z.object({
  unique_id: tenantIdSchema,
  created_at: epochMs,
  external_ids: z.record(z.string(), z.string()),
});

const tenantPatchSchema = z.object({
  external_ids: z.record(z.string(), z.string()),
});

export type TenantCreateBody = z.infer<typeof tenantCreateSchema>;
export type TenantPatchBody = z.infer<typeof tenantPatchSchema>;

export const tenantsApp = new Hono<{ Variables: { tenantId: string } }>()
  .use("/:id/*", async (c, next) => {
    c.set("tenantId", c.req.param("id"));
    await next();
  })
  .post("/", zValidator("json", tenantCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTenant({ tenant: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listTenants());
  })
  .get("/:id", async (c) => {
    const tenant = await getTenant({ uniqueId: c.req.param("id") });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant);
  })
  .patch("/:id", zValidator("json", tenantPatchSchema), async (c) => {
    const tenant = await patchTenant({
      patch: c.req.valid("json"),
      uniqueId: c.req.param("id"),
    });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant);
  })
  .delete("/:id", async (c) => {
    const tenant = await deleteTenant({ uniqueId: c.req.param("id") });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant);
  })
  .get("/:id/entitlements", async (c) => {
    const tenantId = c.req.param("id");
    const tenant = await getTenant({ uniqueId: tenantId });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(await getEntitlements({ tenantId }));
  })
  .route("/:id/assignments", assignmentsApp)
  .route("/:id/coupon-grants", couponGrantsApp)
  .route("/:id/coupon-receipts", couponReceiptsApp)
  .route("/:id/credit-grants", creditGrantsApp)
  .route("/:id/feature-overrides", featureOverridesApp)
  .route("/:id/invoices", invoicesApp)
  .route("/:id/meter-balances", meterBalancesApp)
  .route("/:id/meter-events", meterEventsApp)
  .route("/:id/meter-overrides", meterOverridesApp)
  .route("/:id/payment-methods", paymentMethodsApp)
  .route("/:id/payments", paymentsApp)
  .route("/:id/refunds", refundsApp);
