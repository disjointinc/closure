/**
 * v0/tenant/refund/routes.ts -- HTTP for /v0/tenant/:tenantId/refund: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { refundSchema } from "../../../schemas/refund.ts";
import { refundIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import { LoanServicingError } from "../loan/servicing.ts";
import { valueCreateSchema, valueSchema } from "../../../schemas/value.ts";
import {
  createRefund,
  getRefund,
  listRefunds,
  patchRefund,
} from "./service.ts";

// The call-surface refund: the refunded amount is an owned value passed
// inline, never a reference to one.
export const refundApiSchema = refundSchema
  .omit({ valueId: true })
  .extend({ value: valueSchema });
export type RefundApi = z.infer<typeof refundApiSchema>;

// The tenant is the one in the path; the server mints the refund and
// value ids and stamps createdAt, so the body carries none of them.
const refundCreateSchema = refundSchema
  .omit({
    refundId: true,
    tenantId: true,
    valueId: true,
    createdAt: true,
    startedProcessingAt: true,
    succeededAt: true,
    failedAt: true,
    loanPrincipalAmount: true,
    loanInterestAmount: true,
  })
  .extend({ value: valueCreateSchema });

const refundPatchSchema = z.object({
  event: z.enum(["started_processing", "succeeded", "failed"]),
});

export type RefundCreateBody = z.infer<typeof refundCreateSchema>;
export type RefundPatchBody = z.infer<typeof refundPatchSchema>;

export const refundApp = new Hono<{ Variables: { tenantId: string } }>()
  .onError((error, c) => {
    console.error("refund request failed", error);
    if (error instanceof LoanServicingError) {
      return c.json({ code: error.code, error: error.message }, error.status);
    }
    return c.json({ error: "internal server error" }, 500);
  })
  .use("*", zValidator("param", z.object({ tenantId: tenantIdSchema })))
  .post("/", zValidator("json", refundCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const refund = await createRefund({
      refund: body,
      tenantId: c.get("tenantId"),
    });
    if (!refund) {
      return c.json({ error: "payment not found" }, 404);
    }
    return c.json(refund, 201);
  })
  .get("/", async (c) => {
    return c.json(await listRefunds({ tenantId: c.get("tenantId") }));
  })
  .get(
    "/:refundId",
    zValidator("param", z.object({ refundId: refundIdSchema })),
    async (c) => {
      const refund = await getRefund({
        refundId: c.req.param("refundId"),
        tenantId: c.get("tenantId"),
      });
      if (!refund) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(refund);
    },
  )
  .patch(
    "/:refundId",
    zValidator("param", z.object({ refundId: refundIdSchema })),
    zValidator("json", refundPatchSchema),
    async (c) => {
      const refund = await patchRefund({
        patch: c.req.valid("json"),
        refundId: c.req.param("refundId"),
        tenantId: c.get("tenantId"),
      });
      if (!refund) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(refund);
    },
  );
