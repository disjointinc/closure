/**
 * v0/product-line/routes.ts -- HTTP for /v0/product-line: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../lib/http.ts";
import {
  addOnTypeIdSchema,
  assignmentIdSchema,
  featureIdSchema,
  meterIdSchema,
  planIdSchema,
  productLineIdSchema,
  tenantIdSchema,
} from "../../schemas/ids.ts";
import { productLineSchema } from "../../schemas/product-line.ts";
import {
  consolidateProductLine,
  createProductLine,
  deprecateProductLine,
  getProductLine,
  listProductLines,
  patchProductLine,
  splitProductLine,
} from "./service.ts";

const productLineCreateSchema = productLineSchema.omit({
  createdAt: true,
  deprecatedAt: true,
  productLineId: true,
});

export type ProductLineCreateBody = z.infer<typeof productLineCreateSchema>;

/** Only the synchronization edges are patchable; everything else is immutable. */
const productLinePatchSchema = productLineSchema.pick({
  forceBillingCycleSynchronizationWithProductLineIds: true,
});

export type ProductLinePatchBody = z.infer<typeof productLinePatchSchema>;

/* Features and meters fully partition the source. Plans and add-on types
 * follow their references; planIds/addOnTypeIds exist only for entities
 * with no references to infer from. */
const splitSchema = z.object({
  targets: z
    .array(
      z.object({
        productLineId: productLineIdSchema,
        featureIds: z.array(featureIdSchema),
        meterIds: z.array(meterIdSchema),
        planIds: z.array(planIdSchema).nullable(),
        addOnTypeIds: z.array(addOnTypeIdSchema).nullable(),
      }),
    )
    .min(1),
});

export type SplitProductLineBody = z.infer<typeof splitSchema>;

/** One resolution per tenant with an open assignment in both lines. */
const consolidateSchema = z.object({
  sourceProductLineId: productLineIdSchema,
  resolutions: z.array(
    z.object({
      tenantId: tenantIdSchema,
      keep: z.enum(["source", "target"]),
    }),
  ),
});

export type ConsolidateProductLineBody = z.infer<typeof consolidateSchema>;

const splitResultSchema = z.object({
  deprecatedProductLineId: productLineIdSchema,
  targets: z.array(
    z.object({
      productLineId: productLineIdSchema,
      features: z.number().int(),
      meters: z.number().int(),
      plans: z.number().int(),
      addOnTypes: z.number().int(),
      assignments: z.number().int(),
    }),
  ),
});

const splitErrorSchema = z.object({
  error: z.string(),
  straddlers: z.array(z.string()).optional(),
  unpartitioned: z.array(z.string()).optional(),
});

const consolidateResultSchema = z.object({
  consolidatedProductLineId: productLineIdSchema,
  deprecatedProductLineId: productLineIdSchema,
  endedAssignmentIds: z.array(assignmentIdSchema),
});

const consolidateErrorSchema = z.object({
  error: z.string(),
  missingResolutions: z.array(z.string()).optional(),
});

const createProductLineRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Product line"],
  summary: "Create a product line",
  request: {
    body: {
      content: { "application/json": { schema: productLineCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: productLineSchema } },
      description: "Created",
    },
    400: invalidResponse,
  },
});

const listProductLinesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Product line"],
  summary: "List product lines",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(productLineSchema) } },
      description: "OK",
    },
  },
});

const getProductLineRoute = createRoute({
  method: "get",
  path: "/{productLineId}",
  tags: ["Product line"],
  summary: "Get a product line",
  request: { params: z.object({ productLineId: productLineIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: productLineSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const patchProductLineRoute = createRoute({
  method: "patch",
  path: "/{productLineId}",
  tags: ["Product line"],
  summary: "Patch a product line",
  request: {
    params: z.object({ productLineId: productLineIdSchema }),
    body: {
      content: { "application/json": { schema: productLinePatchSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: productLineSchema } },
      description: "OK",
    },
    400: invalidResponse,
    404: notFoundResponse,
  },
});

const deprecateProductLineRoute = createRoute({
  method: "delete",
  path: "/{productLineId}",
  tags: ["Product line"],
  summary: "Deprecate a product line",
  request: { params: z.object({ productLineId: productLineIdSchema }) },
  responses: {
    200: {
      content: { "application/json": { schema: productLineSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const splitProductLineRoute = createRoute({
  method: "post",
  path: "/{productLineId}/split",
  tags: ["Product line"],
  summary: "Split a product line",
  request: {
    params: z.object({ productLineId: productLineIdSchema }),
    body: {
      content: { "application/json": { schema: splitSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: splitResultSchema } },
      description: "OK",
    },
    400: {
      content: { "application/json": { schema: splitErrorSchema } },
      description: "Invalid input",
    },
    404: notFoundResponse,
  },
});

const consolidateProductLineRoute = createRoute({
  method: "post",
  path: "/{productLineId}/consolidate",
  tags: ["Product line"],
  summary: "Consolidate product lines",
  request: {
    params: z.object({ productLineId: productLineIdSchema }),
    body: {
      content: { "application/json": { schema: consolidateSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: consolidateResultSchema } },
      description: "OK",
    },
    400: {
      content: { "application/json": { schema: consolidateErrorSchema } },
      description: "Invalid input",
    },
    404: notFoundResponse,
  },
});

export const productLineApp = new OpenAPIHono()
  .openapi(createProductLineRoute, async (c) => {
    const productLine = await createProductLine({
      productLine: c.req.valid("json"),
    });
    if ("error" in productLine) {
      return c.json(productLine, 400);
    }
    return c.json(productLine, 201);
  })
  .openapi(listProductLinesRoute, async (c) => {
    return c.json(await listProductLines(), 200);
  })
  .openapi(getProductLineRoute, async (c) => {
    const productLine = await getProductLine({
      productLineId: c.req.param("productLineId"),
    });
    if (!productLine) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(productLine, 200);
  })
  .openapi(patchProductLineRoute, async (c) => {
    const productLine = await patchProductLine({
      patch: c.req.valid("json"),
      productLineId: c.req.param("productLineId"),
    });
    if (!productLine) {
      return c.json({ error: "not found" }, 404);
    }
    if ("error" in productLine) {
      return c.json(productLine, 400);
    }
    return c.json(productLine, 200);
  })
  .openapi(deprecateProductLineRoute, async (c) => {
    const productLine = await deprecateProductLine({
      productLineId: c.req.param("productLineId"),
    });
    if (!productLine) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(productLine, 200);
  })
  .openapi(splitProductLineRoute, async (c) => {
    const result = await splitProductLine({
      body: c.req.valid("json"),
      productLineId: c.req.param("productLineId"),
    });
    if (!result) {
      return c.json({ error: "not found" }, 404);
    }
    if ("error" in result) {
      return c.json(result, 400);
    }
    return c.json(result, 200);
  })
  .openapi(consolidateProductLineRoute, async (c) => {
    const result = await consolidateProductLine({
      body: c.req.valid("json"),
      productLineId: c.req.param("productLineId"),
    });
    if (!result) {
      return c.json({ error: "not found" }, 404);
    }
    if ("error" in result) {
      return c.json(result, 400);
    }
    return c.json(result, 200);
  });
