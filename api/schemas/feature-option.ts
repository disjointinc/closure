import { z } from "zod";
import { featureOptionIdSchema } from "./ids.ts";

/** One enumerated choice of a feature. Lives inside a feature's options. */
export const featureOptionSchema = z.object({
  uniqueId: featureOptionIdSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type FeatureOption = z.infer<typeof featureOptionSchema>;
