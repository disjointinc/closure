/**
 * v0/tenant/routes.ts -- HTTP for /v0/tenant: request validation, wiring,
 * and the mount points for all tenant-scoped resources (each lives in its
 * own nested folder). Business logic lives in service.ts.
 *
 * The /:tenantId/* middleware hands the tenant id to mounted sub-routers as a
 * typed context variable (c.get("tenantId")): Hono can't statically type a
 * param declared by a parent mount, and per-handler guards were noise.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../lib/http.ts";
import { epochMs, featureSetTo, microcredits } from "../../schemas/common.ts";
import {
  assignmentIdSchema,
  featureIdSchema,
  meterIdSchema,
  tenantIdSchema,
} from "../../schemas/ids.ts";
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

/* The tenant endpoints return raw tenants rows; schemas/tenant.ts is the
 * expanded read model, which the service never builds here. */
const tenantRowSchema = z.object({
  tenantId: tenantIdSchema,
  createdAt: epochMs,
  deletedAt: epochMs.nullable(),
  externalIds: z.record(z.string(), z.string()),
});

/* balanceMicrocredits is nullable: the balance lives in Redis and is null
 * until initialized (see getMeterBalance). */
const entitlementsSchema = z.object({
  tenantId: tenantIdSchema,
  assignmentIds: z.array(assignmentIdSchema),
  features: z.array(
    z.object({ featureId: featureIdSchema, setTo: featureSetTo }),
  ),
  meters: z.array(
    z.object({
      meterId: meterIdSchema,
      defaultMicrocredits: microcredits,
      limitMicrocredits: microcredits.nullable(),
      balanceMicrocredits: microcredits.nullable(),
    }),
  ),
});

const createTenantRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant"],
  summary: "Create a tenant",
  request: {
    body: {
      content: { "application/json": { schema: tenantCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: tenantRowSchema } },
      description: "Created",
    },
  },
});

const listTenantsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant"],
  summary: "List tenants",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(tenantRowSchema) } },
      description: "OK",
    },
  },
});

const getTenantRoute = createRoute({
  method: "get",
  path: "/{tenantId}",
  tags: ["tenant"],
  summary: "Get a tenant",
  request: { params: z.object({ tenantId: tenantIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: tenantRowSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const patchTenantRoute = createRoute({
  method: "patch",
  path: "/{tenantId}",
  tags: ["tenant"],
  summary: "Patch a tenant",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: tenantPatchSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: tenantRowSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const deleteTenantRoute = createRoute({
  method: "delete",
  path: "/{tenantId}",
  tags: ["tenant"],
  summary: "Delete a tenant",
  request: { params: z.object({ tenantId: tenantIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: tenantRowSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const getEntitlementsRoute = createRoute({
  method: "get",
  path: "/{tenantId}/entitlements",
  tags: ["tenant"],
  summary: "Get a tenant's entitlements",
  request: { params: z.object({ tenantId: tenantIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: entitlementsSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

/* .use returns the base Hono type, which would erase .openapi from the
 * chain (the same split handler.ts uses for its app-level middleware). */
const app = new OpenAPIHono<{ Variables: { tenantId: string } }>();
app.use("/:tenantId/*", async (c, next) => {
  c.set("tenantId", c.req.param("tenantId"));
  await next();
});

export const tenantApp = app
  .openapi(createTenantRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTenant({ tenant: body }), 201);
  })
  .openapi(listTenantsRoute, async (c) => {
    return c.json(await listTenants(), 200);
  })
  .openapi(getTenantRoute, async (c) => {
    const tenant = await getTenant({ tenantId: c.req.param("tenantId") });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant, 200);
  })
  .openapi(patchTenantRoute, async (c) => {
    const tenant = await patchTenant({
      patch: c.req.valid("json"),
      tenantId: c.req.param("tenantId"),
    });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant, 200);
  })
  .openapi(deleteTenantRoute, async (c) => {
    const tenant = await deleteTenant({ tenantId: c.req.param("tenantId") });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(tenant, 200);
  })
  .openapi(getEntitlementsRoute, async (c) => {
    const tenantId = c.req.param("tenantId");
    const tenant = await getTenant({ tenantId });
    if (!tenant) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(await getEntitlements({ tenantId }), 200);
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
