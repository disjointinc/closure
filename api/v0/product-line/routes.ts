/**
 * v0/product-line/routes.ts -- HTTP for /v0/product-line: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  addOnTypeIdSchema,
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

export const productLineApp = new Hono()
  .post("/", zValidator("json", productLineCreateSchema), async (c) => {
    const productLine = await createProductLine({
      productLine: c.req.valid("json"),
    });
    if ("error" in productLine) {
      return c.json(productLine, 400);
    }
    return c.json(productLine, 201);
  })
  .get("/", async (c) => {
    return c.json(await listProductLines());
  })
  .get("/:productLineId", async (c) => {
    const productLine = await getProductLine({
      productLineId: c.req.param("productLineId"),
    });
    if (!productLine) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(productLine);
  })
  .patch(
    "/:productLineId",
    zValidator("json", productLinePatchSchema),
    async (c) => {
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
      return c.json(productLine);
    },
  )
  .delete("/:productLineId", async (c) => {
    const productLine = await deprecateProductLine({
      productLineId: c.req.param("productLineId"),
    });
    if (!productLine) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(productLine);
  })
  .post("/:productLineId/split", zValidator("json", splitSchema), async (c) => {
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
  .post(
    "/:productLineId/consolidate",
    zValidator("json", consolidateSchema),
    async (c) => {
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
    },
  );
