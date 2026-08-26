import { z } from "zod";
import { epochMs } from "./common.ts";
import { teamMemberIdSchema } from "./ids.ts";

/** A user of the pricing application (the people running Closure). */
export const teamMemberSchema = z.object({
  uniqueId: teamMemberIdSchema,
  deletedAt: epochMs.nullable(),
  emailAddress: z.email(),
  name: z.string().min(1).nullable(),
  profilePictureLink: z.url().nullable(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;
