import {
  currentKeyVersion,
  decryptToken,
  encryptToken,
} from "../../crypto/tokens";
import {
  BYO_KEY_NAMES,
  type ByoPlatform,
  isByoPlatform,
  type PlatformAppInput,
  toSecretOverrides,
} from "../../platforms/byo-keys";
import { PublishError } from "../../platforms/types";
import { createServiceClient } from "../client";

export type PlatformAppPublic = {
  platform: ByoPlatform;
  clientId: string;
  extra: string | null;
  updatedAt: string;
};

/** Dashboard user client (RLS). Reads the public view, never the secret. */
export async function listPlatformApps(
  orgId: string,
): Promise<PlatformAppPublic[]> {
  // Dynamic: the worker imports this file and must not load next/headers.
  const { createServerSupabase } = await import("../server");
  const db = await createServerSupabase();
  const { data, error } = await db
    .from("platform_apps_public")
    .select("platform, client_id, extra, updated_at")
    .eq("org_id", orgId)
    .order("platform");
  if (error) throw error;
  return data.flatMap((r) =>
    r.platform && r.client_id && r.updated_at && isByoPlatform(r.platform)
      ? [
          {
            platform: r.platform,
            clientId: r.client_id,
            extra: r.extra,
            updatedAt: r.updated_at,
          },
        ]
      : [],
  );
}

export async function upsertPlatformApp(
  orgId: string,
  platform: ByoPlatform,
  input: PlatformAppInput,
): Promise<void> {
  const db = await createServiceClient();
  const { error } = await db.from("platform_apps").upsert(
    {
      org_id: orgId,
      platform,
      client_id: input.clientId,
      client_secret_enc: await encryptToken(input.clientSecret),
      extra: input.extra,
      key_version: currentKeyVersion(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,platform" },
  );
  if (error) throw error;
}

export async function deletePlatformApp(
  orgId: string,
  platform: ByoPlatform,
): Promise<void> {
  const db = await createServiceClient();
  const { error } = await db
    .from("platform_apps")
    .delete()
    .eq("org_id", orgId)
    .eq("platform", platform);
  if (error) throw error;
}

export async function hasPlatformApp(
  orgId: string,
  platform: string,
): Promise<boolean> {
  if (!isByoPlatform(platform)) return false;
  const db = await createServiceClient();
  const { data, error } = await db
    .from("platform_apps")
    .select("id")
    .eq("org_id", orgId)
    .eq("platform", platform)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Server only. Env-name to value map for withSecretOverrides; {} when the org has no app. */
export async function loadSecretOverrides(
  orgId: string,
  platform: string,
): Promise<Record<string, string>> {
  if (!isByoPlatform(platform)) return {};
  const db = await createServiceClient();
  const { data, error } = await db
    .from("platform_apps")
    .select("client_id, client_secret_enc, extra")
    .eq("org_id", orgId)
    .eq("platform", platform)
    .maybeSingle();
  if (error) throw error;
  if (!data) return {};
  return toSecretOverrides(platform, {
    clientId: data.client_id,
    clientSecret: await decryptToken(data.client_secret_enc),
    extra: data.extra,
  });
}

/** Client id of the org app that connected an account, from loaded overrides. */
export const byoClientIdOf = (
  platform: string,
  overrides: Record<string, string>,
) =>
  isByoPlatform(platform)
    ? overrides[BYO_KEY_NAMES[platform].id] || null
    : null;

/**
 * Keys an existing account must use. No platform_data.byo_client_id: global keys ({}).
 * With it: the org's app must still exist with that same client id, else auth failure (never the global keys).
 */
export async function overridesForAccount(
  orgId: string,
  platform: string,
  platformData: unknown,
): Promise<Record<string, string>> {
  const want = (platformData as { byo_client_id?: unknown } | null)
    ?.byo_client_id;
  if (typeof want !== "string" || want === "") return {};
  const overrides = await loadSecretOverrides(orgId, platform);
  if (byoClientIdOf(platform, overrides) !== want)
    throw new PublishError(
      "auth_failed",
      "auth",
      "the developer app this account was connected with changed or was removed",
    );
  return overrides;
}
