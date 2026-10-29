import { z } from "zod";

// Field name follows POST /{ig-user-id}/media (instagram.md Publishing endpoints, Container flow).
// Omitted: a single image is a feed post, a single video is a Reel, several items are a carousel.
export const InstagramConfigSchema = z
  .object({
    media_type: z.enum(["REELS", "STORIES"]).optional(),
  })
  .strict();
