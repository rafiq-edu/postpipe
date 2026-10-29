import { z } from "zod";

// Field names follow the videos resource (youtube.md section 4, Fields).
// Required-ness and lengths are checked in rules.ts so each gets its own code.
export const YoutubeConfigSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    privacy_status: z.enum(["private", "unlisted", "public"]).optional(),
    made_for_kids: z.boolean().optional(),
    contains_synthetic_media: z.boolean().optional(),
  })
  .strict();
