/**
 * v0/tenant/routes.ts -- HTTP for /v0/tenant: request validation, wiring,
 * and the mount points for all tenant-scoped resources (each lives in its
 * own nested folder). Business logic lives in service.ts.
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
import { assignmentApp } from "./assignment/routes.ts";
import { couponGrantApp } from "./coupon-grant/routes.ts";
import { couponReceiptApp } from "./coupon-receipt/routes.ts";
import { creditGrantApp } from "./credit-grant/routes.ts";
import { featureOverrideApp } from "./feature-override/routes.ts";
import { invoiceApp } from "./invoice/routes.ts";
import { meterBalanceApp } from "./meter-balance/routes.ts";
import { meterEventApp } from "./meter-event/routes.ts";
import { meterOverrideApp } from "./meter-override/routes.ts";
import { paymentMethodApp } from "./payment-method/routes.ts";
import { paymentApp } from "./payment/routes.ts";
import { refundApp } from "./refund/routes.ts";
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

export const tenantApp = new Hono<{ Variables: { tenantId: string } }>()
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
  .route("/:id/assignment", assignmentApp)
  .route("/:id/coupon-grant", couponGrantApp)
  .route("/:id/coupon-receipt", couponReceiptApp)
  .route("/:id/credit-grant", creditGrantApp)
  .route("/:id/feature-override", featureOverrideApp)
  .route("/:id/invoice", invoiceApp)
  .route("/:id/meter-balance", meterBalanceApp)
  .route("/:id/meter-event", meterEventApp)
  .route("/:id/meter-override", meterOverrideApp)
  .route("/:id/payment-method", paymentMethodApp)
  .route("/:id/payment", paymentApp)
  .route("/:id/refund", refundApp);
