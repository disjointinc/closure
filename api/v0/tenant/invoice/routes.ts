/**
 * v0/tenant/invoice/routes.ts -- HTTP for /v0/tenant/:tenantId/invoice: request
 * validation and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { notFoundResponse } from "../../../lib/http.ts";
import { epochMs } from "../../../schemas/common.ts";
import {
  arrearsChargingSchema,
  upfrontChargingSchema,
} from "../../../schemas/cycle.ts";
import { invoiceIdSchema, tenantIdSchema } from "../../../schemas/ids.ts";
import { itemSchema } from "../../../schemas/item.ts";
import { taxationAmountSchema } from "../../../schemas/taxation-amount.ts";
import { valueCreateSchema, valueSchema } from "../../../schemas/value.ts";
import {
  createInvoice,
  finalizeInvoice,
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

const invoiceItemApiSchema = itemSchema
  .omit({ perUnitValueId: true })
  .extend({ perUnitValue: valueSchema });

const invoiceApiFields = {
  invoiceId: invoiceIdSchema,
  createdAt: epochMs,
  finalizedAt: epochMs.nullable(),
  items: z.array(invoiceItemApiSchema),
  taxationAmounts: z.array(taxationAmountSchema),
};

const invoiceApiSchema = z.discriminatedUnion("charged", [
  upfrontChargingSchema.extend(invoiceApiFields),
  arrearsChargingSchema.extend(invoiceApiFields),
]);

export type InvoiceCreateBody = z.infer<typeof invoiceCreateSchema>;

const createInvoiceRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tenant/invoice"],
  summary: "Create an invoice",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
    body: {
      content: { "application/json": { schema: invoiceCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: invoiceApiSchema } },
      description: "Created",
    },
    404: notFoundResponse,
  },
});

const listInvoicesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tenant/invoice"],
  summary: "List invoices",
  request: {
    params: z.object({ tenantId: tenantIdSchema }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(invoiceApiSchema) } },
      description: "OK",
    },
  },
});

const getInvoiceRoute = createRoute({
  method: "get",
  path: "/{invoiceId}",
  tags: ["tenant/invoice"],
  summary: "Get an invoice",
  request: {
    params: z.object({
      invoiceId: invoiceIdSchema,
      tenantId: tenantIdSchema,
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: invoiceApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const finalizeInvoiceRoute = createRoute({
  method: "post",
  path: "/{invoiceId}/finalize",
  tags: ["tenant/invoice"],
  summary: "Finalize an invoice",
  request: {
    params: z.object({
      invoiceId: invoiceIdSchema,
      tenantId: tenantIdSchema,
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: invoiceApiSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

export const invoiceApp = new OpenAPIHono<{ Variables: { tenantId: string } }>()
  .openapi(createInvoiceRoute, async (c) => {
    const body = c.req.valid("json");
    try {
      const invoice = await createInvoice({
        invoice: body,
        tenantId: c.get("tenantId"),
      });
      if (!invoice) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(invoice, 201);
    } catch (error) {
      if (error instanceof InvoiceTaxNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  })
  .openapi(listInvoicesRoute, async (c) => {
    return c.json(await listInvoices({ tenantId: c.get("tenantId") }), 200);
  })
  .openapi(getInvoiceRoute, async (c) => {
    const invoice = await getInvoice({ invoiceId: c.req.param("invoiceId") });
    if (!invoice) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(invoice, 200);
  })
  .openapi(finalizeInvoiceRoute, async (c) => {
    const invoice = await finalizeInvoice({
      invoiceId: c.req.param("invoiceId"),
    });
    if (!invoice) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(invoice, 200);
  });
