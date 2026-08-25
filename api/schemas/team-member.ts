import { z } from "zod";
import { epochMs } from "./common.ts";
import { teamMemberIdSchema } from "./ids.ts";

/** A user of the pricing application (the people running Closure). */
export const teamMemberSchema = z.object({
  unique_id: teamMemberIdSchema,
  deleted_at: epochMs.nullable(),
  email_address: z.email(),
  name: z.string().min(1).nullable(),
  profile_picture_link: z.url().nullable(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;
