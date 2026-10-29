import { z } from "zod";

// facebook.md section 4: `link` is a feed field (Text or link post); `title` is a videos/video_reels field.
// `reel` is ours: it picks video_reels instead of videos for a single video.
export const FacebookConfigSchema = z
  .object({
    link: z.string().url().optional(),
    title: z.string().optional(),
    reel: z.boolean().optional(),
  })
  .strict();
