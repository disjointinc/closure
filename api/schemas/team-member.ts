import { z } from "zod";
import { epochMs } from "./common.ts";
import { teamMemberIdSchema } from "./ids.ts";

/** A user of the pricing application (the people running Closure). */
export const teamMemberSchema = z.object({
  teamMemberId: teamMemberIdSchema,
  createdAt: epochMs,
  deletedAt: epochMs.nullable(),
  email: z.email(),
  name: z.string().min(1).nullable(),
  profilePictureUrl: z.url().nullable(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;
