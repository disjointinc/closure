/**
 * v0/tenant/routes.ts -- HTTP for /v0/tenant: request validation, wiring,
 * and the mount points for all tenant-scoped resources (each lives in its
 * own nested folder). Business logic lives in service.ts.
 *
 * The /:tenantId/* middleware hands the tenant id to mounted sub-routers as a
 * typed context variable (c.get("tenantId")): Hono can't statically type a
 * param declared by a parent mount, and per-handler guards were noise.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { addOnApp } from "./add-on/routes.ts";
import { assignmentApp } from "./assignment/routes.ts";
import { couponGrantApp } from "./coupon-grant/routes.ts";
import { couponReceiptApp } from "./coupon-receipt/routes.ts";
import { creditGrantApp } from "./credit-grant/routes.ts";
import { featureOverrideApp } from "./feature-override/routes.ts";
import { invoiceApp } from "./invoice/routes.ts";
import { loanApp } from "./loan/routes.ts";
import { meterBalanceApp } from "./meter-balance/routes.ts";
import { meterEventApp } from "./meter-event/routes.ts";
import { meterOverrideApp } from "./meter-override/routes.ts";
import { paymentMethodApp } from "./payment-method/routes.ts";
import { paymentApp } from "./payment/routes.ts";
import { refundApp } from "./refund/routes.ts";
import { taskApp } from "./task/routes.ts";
import {
  createTenant,
  deleteTenant,
  getEntitlements,
  getTenant,
  listTenants,
  patchTenant,
} from "./service.ts";

const tenantCreateSchema = z.object({
  externalIds: z.record(z.string(), z.string()),
});

const tenantPatchSchema = z.object({
  externalIds: z.record(z.string(), z.string()),
});

export type TenantCreateBody = z.infer<typeof tenantCreateSchema>;
export type TenantPatchBody = z.infer<typeof tenantPatchSchema>;

export const tenantApp = new Hono<{ Variables: { tenantId: string } }>()
  .use("/:tenantId/*", async (c, next) => {
    c.set("tenantId", c.req.param("tenantId"));
    await next();
  })
  .post("/", zValidator("json", tenantCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTenant({ tenant: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listTenants());
  })
  .get("/:tenantId", async (c) => {
    const tenant = await getTenant({ tenantId: c.req.param("tenantId") });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant);
  })
  .patch("/:tenantId", zValidator("json", tenantPatchSchema), async (c) => {
    const tenant = await patchTenant({
      patch: c.req.valid("json"),
      tenantId: c.req.param("tenantId"),
    });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant);
  })
  .delete("/:tenantId", async (c) => {
    const tenant = await deleteTenant({ tenantId: c.req.param("tenantId") });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant);
  })
  .get("/:tenantId/entitlements", async (c) => {
    const tenantId = c.req.param("tenantId");
    const tenant = await getTenant({ tenantId });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(await getEntitlements({ tenantId }));
  })
  .route("/:tenantId/add-on", addOnApp)
  .route("/:tenantId/assignment", assignmentApp)
  .route("/:tenantId/coupon-grant", couponGrantApp)
  .route("/:tenantId/coupon-receipt", couponReceiptApp)
  .route("/:tenantId/credit-grant", creditGrantApp)
  .route("/:tenantId/feature-override", featureOverrideApp)
  .route("/:tenantId/invoice", invoiceApp)
  .route("/:tenantId/loan", loanApp)
  .route("/:tenantId/meter-balance", meterBalanceApp)
  .route("/:tenantId/meter-event", meterEventApp)
  .route("/:tenantId/meter-override", meterOverrideApp)
  .route("/:tenantId/payment", paymentApp)
  .route("/:tenantId/payment-method", paymentMethodApp)
  .route("/:tenantId/refund", refundApp)
  .route("/:tenantId/task", taskApp);
