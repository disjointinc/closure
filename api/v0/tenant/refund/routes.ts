/**
 * v0/tenant/refund/routes.ts -- HTTP for /v0/tenant/:id/refund: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../../schemas/common.ts";
import { refundSchema } from "../../../schemas/refund.ts";
import { valueRefSchema } from "../../value/service.ts";
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
    startedProcessingAt: epochMs.nullable(),
    succeededAt: epochMs.nullable(),
    failedAt: epochMs.nullable(),
  })
  .partial();

export type RefundCreateBody = z.infer<typeof refundCreateSchema>;
export type RefundPatchBody = z.infer<typeof refundPatchSchema>;

export const refundApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", refundCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createRefund({ refund: body, tenantId: c.get("tenantId") }),
      201,
    );
  })
  .get("/", async (c) => {
    return c.json(await listRefunds({ tenantId: c.get("tenantId") }));
  })
  .get("/:refund_id", async (c) => {
    const refund = await getRefund({ refundId: c.req.param("refund_id") });
    if (!refund) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(refund);
  })
  .patch("/:refund_id", zValidator("json", refundPatchSchema), async (c) => {
    const refund = await patchRefund({
      patch: c.req.valid("json"),
      refundId: c.req.param("refund_id"),
    });
    if (!refund) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(refund);
  });
