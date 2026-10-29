import { z } from "zod";

// Field names follow POST /2/tweets (x.md section 4, "Create post" and section 1).
export const XConfigSchema = z
  .object({
    reply_settings: z
      .enum(["following", "mentionedUsers", "subscribers", "verified"])
      .optional(), // x.md section 1: Reply settings
  })
  .strict();
