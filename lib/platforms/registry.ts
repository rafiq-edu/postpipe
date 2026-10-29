import { blueskyAdapter } from "./bluesky/adapter";
import { facebookAdapter } from "./facebook/adapter";
import { instagramAdapter } from "./instagram/adapter";
import { linkedinAdapter } from "./linkedin/adapter";
import { mockAdapter } from "./mock/adapter";
import { pinterestAdapter } from "./pinterest/adapter";
import { threadsAdapter } from "./threads/adapter";
import { tiktokAdapter } from "./tiktok/adapter";
import type { Platform, PlatformAdapter } from "./types";
import { xAdapter } from "./x/adapter";
import { youtubeAdapter } from "./youtube/adapter";

// Later tasks add entries.
const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = {
  bluesky: blueskyAdapter,
  x: xAdapter,
  facebook: facebookAdapter,
  instagram: instagramAdapter,
  linkedin: linkedinAdapter,
  pinterest: pinterestAdapter,
  threads: threadsAdapter,
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
  mock: mockAdapter,
};

export function hasAdapter(platform: Platform): boolean {
  return ADAPTERS[platform] !== undefined;
}

export function availablePlatforms(): Platform[] {
  return Object.keys(ADAPTERS) as Platform[];
}

export function getAdapter(platform: Platform): PlatformAdapter {
  const a = ADAPTERS[platform];
  if (!a) throw new Error(`adapter not registered: ${platform}`);
  return a;
}

export function adapterFor(
  mode: "live" | "test",
  platform: Platform,
): PlatformAdapter {
  return mode === "test" ? mockAdapter : getAdapter(platform);
}
