import { z } from "zod";

// Field names follow app.bsky.feed.post (bluesky.md section 4).
export const BlueskyConfigSchema = z
  .object({
    langs: z.array(z.string().min(2).max(35)).max(3).optional(), // bluesky.md section 1: langs max 3
    tags: z.array(z.string().min(1).max(64)).max(8).optional(), // bluesky.md section 1: tags max 8
  })
  .strict();
