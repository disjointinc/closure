/**
 * v0/refunds/routes.ts -- HTTP for /v0/tenants/:id/refunds: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../schemas/common.ts";
import { refundSchema } from "../../schemas/refund.ts";
import { tenantParam, valueRefSchema } from "../helpers.ts";
import {
  createRefund,
  getRefund,
  listRefunds,
  patchRefund,
} from "./service.ts";

const refundCreateSchema = z.object({
  ...refundSchema.shape,
  value: valueRefSchema,
});

const refundPatchSchema = z
  .object({
    started_processing_at: epochMs.nullable(),
    succeeded_at: epochMs.nullable(),
    failed_at: epochMs.nullable(),
  })
  .partial();

export type RefundCreateBody = z.infer<typeof refundCreateSchema>;
export type RefundPatchBody = z.infer<typeof refundPatchSchema>;

export const refundsApp = new Hono()
  .post("/", zValidator("json", refundCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createRefund({ refund: body, tenantId: tenantParam(c) }),
      201,
    );
  })
  .get("/", async (c) => {
    return c.json(await listRefunds({ tenantId: tenantParam(c) }));
  })
  .get("/:rid", async (c) => {
    const refund = await getRefund({ refundId: c.req.param("rid") });
    if (!refund) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(refund);
  })
  .patch("/:rid", zValidator("json", refundPatchSchema), async (c) => {
    const refund = await patchRefund({
      patch: c.req.valid("json"),
      refundId: c.req.param("rid"),
    });
    if (!refund) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(refund);
  });
