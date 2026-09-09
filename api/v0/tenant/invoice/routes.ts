/**
 * v0/tenant/invoice/routes.ts -- HTTP for /v0/tenant/:tenantId/invoice: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  arrearsChargingSchema,
  upfrontChargingSchema,
} from "../../../schemas/cycle.ts";
import { itemSchema } from "../../../schemas/item.ts";
import { taxationAmountSchema } from "../../../schemas/taxation-amount.ts";
import { valueCreateSchema } from "../../../schemas/value.ts";
import {
  closeInvoice,
  createInvoice,
  getInvoice,
  InvoiceTaxNotFoundError,
  listInvoices,
} from "./service.ts";

// Items own their per-unit value: always passed as a full object.
const itemInputSchema = itemSchema
  .omit({ itemId: true, perUnitValueId: true })
  .extend({ perUnitValue: valueCreateSchema });

const taxationAmountInputSchema = taxationAmountSchema
  .omit({ appliesToItemIds: true, taxationAmountId: true })
  /* Item ids are server-minted, so taxes reference the request's items by
   * position instead. */
  .extend({
    appliesToItemIndexes: z.array(z.number().int().nonnegative()).nullable(),
  });

const invoiceInputFields = {
  items: z.array(itemInputSchema),
  taxationAmounts: z.array(taxationAmountInputSchema),
};

const invoiceCreateSchema = z
  .discriminatedUnion("charged", [
    upfrontChargingSchema.extend(invoiceInputFields),
    arrearsChargingSchema.extend(invoiceInputFields),
  ])
  .superRefine((invoice, ctx) => {
    invoice.taxationAmounts.forEach((tax, taxIndex) => {
      tax.appliesToItemIndexes?.forEach((itemIndex) => {
        if (itemIndex >= invoice.items.length) {
          ctx.addIssue({
            code: "custom",
            path: ["taxationAmounts", taxIndex, "appliesToItemIndexes"],
            message: "item index out of range",
          });
        }
      });
    });
  });

const closeInvoiceSchema = z.object({
  closedReason: z.string().nullable(),
});

export type InvoiceCreateBody = z.infer<typeof invoiceCreateSchema>;
export type CloseInvoiceBody = z.infer<typeof closeInvoiceSchema>;

export const invoiceApp = new Hono<{ Variables: { tenantId: string } }>()
  .post("/", zValidator("json", invoiceCreateSchema), async (c) => {
    const body = c.req.valid("json");
    try {
      return c.json(
        await createInvoice({ invoice: body, tenantId: c.get("tenantId") }),
        201,
      );
    } catch (error) {
      if (error instanceof InvoiceTaxNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  })
  .get("/", async (c) => {
    return c.json(await listInvoices({ tenantId: c.get("tenantId") }));
  })
  .get("/:invoiceId", async (c) => {
    const invoice = await getInvoice({ invoiceId: c.req.param("invoiceId") });
    if (!invoice) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(invoice);
  })
  .post(
    "/:invoiceId/close",
    zValidator("json", closeInvoiceSchema),
    async (c) => {
      const invoice = await closeInvoice({
        body: c.req.valid("json"),
        invoiceId: c.req.param("invoiceId"),
      });
      if (!invoice) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(invoice);
    },
  );
