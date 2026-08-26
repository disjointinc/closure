/**
 * v0/tenant/invoice/routes.ts -- HTTP for /v0/tenant/:id/invoice: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../../schemas/common.ts";
import {
  arrearsChargingSchema,
  upfrontChargingSchema,
} from "../../../schemas/cycle.ts";
import { invoiceIdSchema } from "../../../schemas/ids.ts";
import { itemSchema } from "../../../schemas/item.ts";
import { taxationAmountSchema } from "../../../schemas/taxation-amount.ts";
import { taxRefSchema } from "../../tax/service.ts";
import { valueRefSchema } from "../../value/service.ts";
import {
  closeInvoice,
  createInvoice,
  getInvoice,
  listInvoices,
} from "./service.ts";

const itemInputSchema = z.object({
  ...itemSchema.shape,
  perUnitValue: valueRefSchema,
});

const taxationAmountInputSchema = z.object({
  ...taxationAmountSchema.shape,
  tax: taxRefSchema,
});

const invoiceInputFields = {
  uniqueId: invoiceIdSchema,
  createdAt: epochMs,
  closedAt: epochMs.nullable(),
  closedReason: z.string().nullable(),
  items: z.array(itemInputSchema),
  taxationAmounts: z.array(taxationAmountInputSchema),
};

const invoiceCreateSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(invoiceInputFields),
  arrearsChargingSchema.extend(invoiceInputFields),
]);

const closeInvoiceSchema = z.object({
  closedAt: epochMs,
  closedReason: z.string().nullable(),
});

export type InvoiceCreateBody = z.infer<typeof invoiceCreateSchema>;
export type CloseInvoiceBody = z.infer<typeof closeInvoiceSchema>;

export const invoiceApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", invoiceCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createInvoice({ invoice: body, tenantId: c.get("tenantId") }),
      201,
    );
  })
  .get("/", async (c) => {
    return c.json(await listInvoices({ tenantId: c.get("tenantId") }));
  })
  .get("/:invoice_id", async (c) => {
    const invoice = await getInvoice({ uniqueId: c.req.param("invoice_id") });
    if (!invoice) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(invoice);
  })
  .post(
    "/:invoice_id/close",
    zValidator("json", closeInvoiceSchema),
    async (c) => {
      const invoice = await closeInvoice({
        body: c.req.valid("json"),
        uniqueId: c.req.param("invoice_id"),
      });
      if (!invoice) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(invoice);
    },
  );
