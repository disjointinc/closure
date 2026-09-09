/**
 * v0/tenant/payment/routes.ts -- HTTP for /v0/tenant/:tenantId/payment: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { paymentLoanSchema, paymentSchema } from "../../../schemas/payment.ts";
import { paymentIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import { LoanServicingError } from "../loan/servicing.ts";
import {
  createPayment,
  getPayment,
  listPayments,
  patchPayment,
} from "./service.ts";

// The server mints the id and stamps createdAt; lifecycle timestamps
// start null and move via PATCH events. Loan allocation starts null.
const paymentCreateSchema = paymentSchema
  .omit({
    paymentId: true,
    createdAt: true,
    startedProcessingAt: true,
    succeededAt: true,
    failedAt: true,
  })
  .extend({
    loan: paymentLoanSchema
      .omit({ principalAmount: true, interestAmount: true })
      .nullable()
      .default(null),
  });

const paymentPatchSchema = z.object({
  event: z.enum(["started_processing", "succeeded", "failed"]),
});

export type PaymentCreateBody = z.infer<typeof paymentCreateSchema>;
export type PaymentPatchBody = z.infer<typeof paymentPatchSchema>;

export const paymentApp = new Hono<{ Variables: { tenantId: string } }>()
  .onError((error, c) => {
    console.error("payment request failed", error);
    if (error instanceof LoanServicingError) {
      return c.json({ code: error.code, error: error.message }, error.status);
    }
    return c.json({ error: "internal server error" }, 500);
  })
  .use("*", zValidator("param", z.object({ tenantId: tenantIdSchema })))
  .post("/", zValidator("json", paymentCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const payment = await createPayment({
      payment: body,
      tenantId: c.get("tenantId"),
    });
    if (!payment) {
      return c.json({ error: "loan or invoice not found" }, 404);
    }
    return c.json(payment, 201);
  })
  .get("/", async (c) => {
    return c.json(await listPayments({ tenantId: c.get("tenantId") }));
  })
  .get(
    "/:paymentId",
    zValidator("param", z.object({ paymentId: paymentIdSchema })),
    async (c) => {
      const payment = await getPayment({
        paymentId: c.req.param("paymentId"),
        tenantId: c.get("tenantId"),
      });
      if (!payment) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(payment);
    },
  )
  .patch(
    "/:paymentId",
    zValidator("param", z.object({ paymentId: paymentIdSchema })),
    zValidator("json", paymentPatchSchema),
    async (c) => {
      const payment = await patchPayment({
        patch: c.req.valid("json"),
        paymentId: c.req.param("paymentId"),
        tenantId: c.get("tenantId"),
      });
      if (!payment) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(payment);
    },
  );
