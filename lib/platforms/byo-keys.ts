// shortcut: TikTok webhook and Meta deauthorize/data-deletion routes verify with PostPipe's global app secret only; upgrade when a BYO customer needs those callbacks.
import { z } from "zod";

export const BYO_PLATFORMS = [
  "x",
  "linkedin",
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "pinterest",
] as const;
export type ByoPlatform = (typeof BYO_PLATFORMS)[number];

export function isByoPlatform(p: string): p is ByoPlatform {
  return (BYO_PLATFORMS as readonly string[]).includes(p);
}

export const BYO_KEY_NAMES: Record<
  ByoPlatform,
  { id: string; secret: string; extra?: string }
> = {
  x: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" },
  linkedin: { id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
  facebook: {
    id: "META_APP_ID",
    secret: "META_APP_SECRET",
    extra: "META_LOGIN_CONFIG_ID",
  },
  instagram: { id: "INSTAGRAM_APP_ID", secret: "INSTAGRAM_APP_SECRET" },
  threads: { id: "THREADS_APP_ID", secret: "THREADS_APP_SECRET" },
  tiktok: { id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },
  youtube: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  pinterest: { id: "PINTEREST_APP_ID", secret: "PINTEREST_APP_SECRET" },
};

export type PlatformAppInput = {
  clientId: string;
  clientSecret: string;
  extra: string | null;
};

export function toSecretOverrides(
  platform: ByoPlatform,
  app: PlatformAppInput,
): Record<string, string> {
  const names = BYO_KEY_NAMES[platform];
  const out: Record<string, string> = {
    [names.id]: app.clientId,
    [names.secret]: app.clientSecret,
  };
  // Empty value masks the global one, so an org app never picks up PostPipe's extra id.
  if (names.extra) out[names.extra] = app.extra ?? "";
  return out;
}

export const PlatformAppInputSchema = z
  .object({
    platform: z.enum(BYO_PLATFORMS),
    client_id: z.string().trim().min(1).max(200),
    client_secret: z.string().trim().min(1).max(500),
    extra: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Facebook Login for Business needs the login config id (facebook adapter getAuthUrl).
    if (v.platform === "facebook" && !v.extra)
      ctx.addIssue({
        code: "custom",
        path: ["extra"],
        message: "Login config ID is required",
      });
  })
  // Only Facebook has an extra field; never store one for other platforms.
  .transform((v) => ({
    ...v,
    extra: v.platform === "facebook" ? v.extra : undefined,
  }));
