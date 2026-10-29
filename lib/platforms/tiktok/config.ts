import { z } from "zod";

// Field names follow the Content Posting API (tiktok.md section 4, Init body).
// Required-ness and lengths are checked in rules.ts so each gets its own code.
export const TiktokConfigSchema = z
  .object({
    // DIRECT_POST publishes at once; MEDIA_UPLOAD sends a draft to the creator's inbox (tiktok.md section 1).
    post_mode: z.enum(["DIRECT_POST", "MEDIA_UPLOAD"]).optional(),
    // tiktok.md section 1, Privacy levels.
    privacy_level: z
      .enum([
        "PUBLIC_TO_EVERYONE",
        "MUTUAL_FOLLOW_FRIENDS",
        "FOLLOWER_OF_CREATOR",
        "SELF_ONLY",
      ])
      .optional(),
    title: z.string().optional(),
    disable_comment: z.boolean().optional(),
    disable_duet: z.boolean().optional(),
    disable_stitch: z.boolean().optional(),
    brand_content_toggle: z.boolean().optional(),
    brand_organic_toggle: z.boolean().optional(),
    is_aigc: z.boolean().optional(),
    video_cover_timestamp_ms: z.number().int().min(0).optional(),
    auto_add_music: z.boolean().optional(),
    photo_cover_index: z.number().int().min(0).optional(),
  })
  .strict();
