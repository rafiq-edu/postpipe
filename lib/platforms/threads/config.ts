import { z } from "zod";

// Field names follow POST /{threads-user-id}/threads (threads.md section 4, Step 1).
export const ThreadsConfigSchema = z
  .object({
    reply_control: z
      .enum([
        "everyone",
        "accounts_you_follow",
        "mentioned_only",
        "parent_post_author_only",
        "followers_only",
      ])
      .optional(),
  })
  .strict();
