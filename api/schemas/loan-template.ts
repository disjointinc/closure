import { z } from "zod";
import { epochMs } from "./common.ts";
import { loanTemplateIdSchema } from "./ids.ts";
import { loanDefinitionFields } from "./loan.ts";

/**
 * A reusable loan definition. Templates are deprecated, never deleted:
 * loans minted from one keep their copied definition.
 */
export const loanTemplateSchema = z.object({
  loanTemplateId: loanTemplateIdSchema,
  createdAt: epochMs,
  deprecatedAt: epochMs.nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  ...loanDefinitionFields,
});
export type LoanTemplate = z.infer<typeof loanTemplateSchema>;
