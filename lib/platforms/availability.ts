import { hasPlatformApp } from "../db/queries/platform-apps";

/** Platforms this deployment's own approved apps may serve. */
export function publicPlatforms(): Set<string> {
  return new Set(
    (process.env.PUBLIC_PLATFORMS ?? "bluesky,x,linkedin")
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function platformAvailable(
  orgId: string,
  platform: string,
): Promise<boolean> {
  return (
    publicPlatforms().has(platform) || (await hasPlatformApp(orgId, platform))
  );
}

/** Same rule as platformAvailable, when the org's overrides are already loaded. */
export function keysAvailable(
  platform: string,
  overrides: Record<string, string>,
): boolean {
  // mock never talks to a platform, so it needs no developer app.
  return (
    platform === "mock" ||
    publicPlatforms().has(platform) ||
    Object.keys(overrides).length > 0
  );
}

export const notAvailableMessage = (label: string) =>
  `${label} is not available on this PostPipe yet. Add your own developer app in Settings, or wait for PostPipe's approval.`;
