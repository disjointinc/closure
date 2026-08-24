import { z } from "zod";
import { optionIdSchema } from "./ids.ts";

/** One enumerated choice of a feature. Lives inside a feature's options. */
export const optionSchema = z.object({
  unique_id: optionIdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
});
export type Option = z.infer<typeof optionSchema>;
