import { z } from "zod";
import { teamMemberIdSchema } from "./ids.ts";

/** A user of the pricing application (the people running Closure). */
export const teamMemberSchema = z.object({
  unique_id: teamMemberIdSchema,
  email_address: z.email(),
  name: z.string().min(1).optional(),
  profile_picture_link: z.url().optional(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;
