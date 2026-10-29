import { type ZodTypeAny, z } from "zod";
import { BlueskyConfigSchema } from "./bluesky/config";
import { FacebookConfigSchema } from "./facebook/config";
import { InstagramConfigSchema } from "./instagram/config";
import { LinkedInConfigSchema } from "./linkedin/config";
import { PinterestConfigSchema } from "./pinterest/config";
import { ThreadsConfigSchema } from "./threads/config";
import { TiktokConfigSchema } from "./tiktok/config";
import type { Platform } from "./types";
import { XConfigSchema } from "./x/config";
import { YoutubeConfigSchema } from "./youtube/config";

export const MockConfigSchema = z
  .object({
    fail: z.boolean().optional(),
    delay_ms: z.number().int().min(0).max(60_000).optional(),
  })
  .strict();

// Later adapter tasks add their own entries here.
export const PLATFORM_CONFIG_SCHEMAS: Partial<Record<Platform, ZodTypeAny>> = {
  bluesky: BlueskyConfigSchema,
  x: XConfigSchema,
  facebook: FacebookConfigSchema,
  instagram: InstagramConfigSchema,
  linkedin: LinkedInConfigSchema,
  pinterest: PinterestConfigSchema,
  threads: ThreadsConfigSchema,
  tiktok: TiktokConfigSchema,
  youtube: YoutubeConfigSchema,
  mock: MockConfigSchema,
};
