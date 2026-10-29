import type { z } from "zod";
import { ApiError } from "../../api/errors";
import { applyCursor, pageOf } from "../../api/pagination";
import type { SocialAccountSchema } from "../../api/schemas/social-accounts";
import { releaseBlueskyOAuth } from "../../connect/bluesky-oauth";
import { CONNECT_SESSION_TTL_MS } from "../../connect/oauth";
import { PICKED_OR } from "../../connect/unpicked";
import {
  currentKeyVersion,
  decryptToken,
  encryptToken,
} from "../../crypto/tokens";
import { logger } from "../../log/logger";
import { redact } from "../../log/redact";
import { adapterFor } from "../../platforms/registry";
import type { Json, Platform, Target, TokenSet } from "../../platforms/types";
import { withSecretOverrides } from "../../secrets";
import { emit } from "../../webhooks/events";
import { createServiceClient } from "../client";
import type { Tables } from "../types";
import { overridesForAccount } from "./platform-apps";

export type SocialAccountRow = Tables<"social_accounts">;

const PUBLIC_COLS =
  "id, org_id, mode, platform, external_id, platform_user_id, display_name, avatar_url, username, status, token_expires_at, created_at, updated_at, deleted_at";

export type SocialAccountPublicRow = Pick<
  SocialAccountRow,
  | "id"
  | "org_id"
  | "mode"
  | "platform"
  | "external_id"
  | "platform_user_id"
  | "display_name"
  | "avatar_url"
  | "username"
  | "status"
  | "token_expires_at"
  | "created_at"
  | "updated_at"
  | "deleted_at"
>;

export function serializeAccount(
  row: SocialAccountPublicRow,
): z.output<typeof SocialAccountSchema> {
  return {
    id: row.id,
    platform: row.platform as Platform,
    external_id: row.external_id,
    platform_user_id: row.platform_user_id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    status: row.status as z.output<typeof SocialAccountSchema>["status"],
    token_expires_at: row.token_expires_at,
    created_at: row.created_at,
  };
}

// Bluesky routing fields are set by the server only; caller data must not pick the auth path.
const BLUESKY_RESERVED = ["auth", "did", "pds", "pds_url", "handle"];
// byo_client_id (the org app an account was connected with) is server-set for every platform.
function callerData(platform: Platform, d: Record<string, Json>) {
  return Object.fromEntries(
    Object.entries(d).filter(
      ([k]) =>
        k !== "byo_client_id" &&
        (platform !== "bluesky" || !BLUESKY_RESERVED.includes(k)),
    ),
  );
}

/** Sets or clears byo_client_id on a platform_data object. */
function withByo(d: Record<string, Json>, byo: string | null | undefined) {
  const { byo_client_id: _old, ...rest } = d;
  return byo ? { ...rest, byo_client_id: byo } : rest;
}

export async function upsertSocialAccount(i: {
  orgId: string;
  mode: "live" | "test";
  platform: Platform;
  externalId: string;
  profile: {
    platformUserId: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
  tokens: TokenSet;
  platformData: Record<string, Json>;
  /** Client id of the org's own app used for this connection; null for PostPipe's global app. */
  byoClientId?: string | null;
}): Promise<SocialAccountRow> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .upsert(
      {
        org_id: i.orgId,
        mode: i.mode,
        platform: i.platform,
        external_id: i.externalId,
        platform_user_id: i.profile.platformUserId,
        username: i.profile.username,
        display_name: i.profile.displayName,
        avatar_url: i.profile.avatarUrl ?? null,
        access_token_enc: await encryptToken(i.tokens.accessToken),
        refresh_token_enc: i.tokens.refreshToken
          ? await encryptToken(i.tokens.refreshToken)
          : null,
        key_version: currentKeyVersion(),
        token_expires_at: i.tokens.expiresAt ?? null,
        refresh_expires_at: i.tokens.refreshExpiresAt ?? null,
        scopes: i.tokens.scopes,
        platform_data: withByo(
          {
            ...callerData(i.platform, i.platformData),
            ...i.tokens.platformData,
          },
          i.byoClientId,
        ),
        status: "connected",
        expiring_notified_at: null,
        deleted_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,platform,platform_user_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function findAccountByPlatformUser(
  orgId: string,
  platform: Platform,
  platformUserId: string,
): Promise<SocialAccountRow | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .select("*")
    .eq("org_id", orgId)
    .eq("platform", platform)
    .eq("platform_user_id", platformUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findAccountById(
  orgId: string,
  id: string,
): Promise<SocialAccountRow | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadTokenSet(row: SocialAccountRow): Promise<TokenSet> {
  if (row.access_token_enc === null) throw new Error("account has no token");
  return {
    accessToken: await decryptToken(row.access_token_enc),
    refreshToken: row.refresh_token_enc
      ? await decryptToken(row.refresh_token_enc)
      : undefined,
    expiresAt: row.token_expires_at ?? undefined,
    refreshExpiresAt: row.refresh_expires_at ?? undefined,
    scopes: row.scopes,
    platformData: (row.platform_data ?? {}) as Record<string, Json>,
  };
}

export async function setAccountTarget(
  accountId: string,
  target: Target,
): Promise<void> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .select("platform_data")
    .eq("id", accountId)
    .single();
  if (error) throw error;
  const { error: e2 } = await db
    .from("social_accounts")
    .update({
      platform_data: {
        ...(data.platform_data as Record<string, Json>),
        target: { id: target.id, kind: target.kind, name: target.name },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (e2) throw e2;
}

/**
 * Stores the chosen target's own token (Facebook Page token) on the account:
 * the row is keyed by the target id, so picking the same Page again in the
 * same org updates that row instead of adding a second one. Returns the id of
 * the row that holds the target.
 */
export async function setAccountTargetToken(
  accountId: string,
  target: Target,
  tokens: TokenSet,
): Promise<{ ok: true; id: string } | { ok: false; reason: "mode_conflict" }> {
  const db = await createServiceClient();
  const { data: row, error } = await db
    .from("social_accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (error) throw error;
  const { data: dup, error: de } = await db
    .from("social_accounts")
    .select("id, mode, platform_data")
    .eq("org_id", row.org_id)
    .eq("platform", row.platform)
    .eq("platform_user_id", target.id)
    .neq("id", accountId)
    .maybeSingle();
  if (de) throw de;
  if (dup && dup.mode !== row.mode)
    return { ok: false, reason: "mode_conflict" };
  const patch = {
    mode: row.mode,
    external_id: row.external_id,
    platform_user_id: target.id,
    username: target.name,
    display_name: target.name,
    access_token_enc: await encryptToken(tokens.accessToken),
    refresh_token_enc: tokens.refreshToken
      ? await encryptToken(tokens.refreshToken)
      : null,
    key_version: currentKeyVersion(),
    token_expires_at: tokens.expiresAt ?? null,
    refresh_expires_at: tokens.refreshExpiresAt ?? null,
    scopes: tokens.scopes,
    // The old duplicate row may carry another app's client id: only this connection's value counts.
    platform_data: withByo(
      {
        ...((dup?.platform_data ?? {}) as Record<string, Json>),
        ...(row.platform_data as Record<string, Json>),
        ...tokens.platformData,
        target: { id: target.id, kind: target.kind, name: target.name },
      },
      (row.platform_data as { byo_client_id?: unknown } | null)
        ?.byo_client_id as string | undefined,
    ),
    status: "connected" as const,
    expiring_notified_at: null,
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };
  const keep = dup?.id ?? accountId;
  const { error: ue } = await db
    .from("social_accounts")
    .update(patch)
    .eq("id", keep);
  if (ue) throw ue;
  if (dup) {
    // The connection row (keyed by the user) is no longer needed. Soft-delete it: a hard delete would cascade into its post targets.
    const { error: re } = await db
      .from("social_accounts")
      .update({
        ...WIPE,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", accountId);
    if (re) throw re;
  }
  return { ok: true, id: keep };
}

export async function listAccounts(
  orgId: string,
  mode: "live" | "test",
  q: {
    limit: number;
    cursor?: string;
    external_id?: string;
    platform?: Platform;
  },
): Promise<{ data: SocialAccountPublicRow[]; next_cursor: string | null }> {
  const db = await createServiceClient();
  let query = db
    .from("social_accounts")
    .select(PUBLIC_COLS)
    .eq("org_id", orgId)
    .eq("mode", mode)
    .is("deleted_at", null)
    .or(PICKED_OR);
  if (q.external_id) query = query.eq("external_id", q.external_id);
  if (q.platform) query = query.eq("platform", q.platform);
  const { data, error } = await applyCursor(query, q.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (error) throw error;
  return pageOf(data, q.limit);
}

export async function getAccount(
  orgId: string,
  mode: "live" | "test",
  id: string,
): Promise<SocialAccountPublicRow | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .select(PUBLIC_COLS)
    .eq("org_id", orgId)
    .eq("mode", mode)
    .eq("id", id)
    .is("deleted_at", null)
    .or(PICKED_OR)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findLive(
  orgId: string,
  mode: "live" | "test",
  id: string,
): Promise<SocialAccountRow> {
  const row = await findAccountById(orgId, id);
  if (!row || row.mode !== mode || row.deleted_at !== null)
    throw new ApiError(404, "not_found", "Social account not found");
  return row;
}

const WIPE = {
  status: "disconnected",
  access_token_enc: null,
  refresh_token_enc: null,
  token_expires_at: null,
  refresh_expires_at: null,
} as const;

async function wipe(
  row: SocialAccountRow,
  extra: { deleted_at?: string },
): Promise<SocialAccountPublicRow> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .update({ ...WIPE, ...extra, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .select(PUBLIC_COLS)
    .single();
  if (error) throw error;
  if (row.status !== "disconnected")
    await emit(
      row.org_id,
      row.mode as "live" | "test",
      "social.account.disconnected",
      {
        account_id: row.id,
        platform: row.platform,
        external_id: row.external_id,
      },
    );
  return data;
}

/**
 * Wipes Facebook connection rows that never got a Page pick and are older than the connect
 * session. No webhook: `created` was never sent for them.
 */
export async function wipeStaleUnpicked(now: Date): Promise<number> {
  const db = await createServiceClient();
  const cutoff = new Date(now.getTime() - CONNECT_SESSION_TTL_MS).toISOString();
  const { data, error } = await db
    .from("social_accounts")
    .update({
      ...WIPE,
      deleted_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("platform", "facebook")
    .is("platform_data->target", null)
    .is("deleted_at", null)
    .lt("updated_at", cutoff)
    .select("id");
  if (error) throw error;
  return data.length;
}

export async function disconnectAccount(
  orgId: string,
  mode: "live" | "test",
  id: string,
): Promise<SocialAccountPublicRow> {
  const row = await findLive(orgId, mode, id);
  if (
    (row.status === "connected" || row.status === "expired") &&
    row.access_token_enc !== null
  ) {
    try {
      // Best effort like the revoke itself: a missing or changed org app only means the remote revoke is skipped.
      await withSecretOverrides(
        await overridesForAccount(row.org_id, row.platform, row.platform_data),
        async () =>
          adapterFor(mode, row.platform as Platform).revoke(
            await loadTokenSet(row),
          ),
      );
    } catch (e) {
      // a failed remote revoke never blocks the disconnect
      logger.warn("account.revoke_failed", {
        account_id: id,
        platform: row.platform,
        error: redact(e),
      });
    }
  }
  const out = await wipe(row, {});
  await releaseBlueskyOAuth(row).catch((e) =>
    logger.warn("account.oauth_release_failed", {
      account_id: id,
      error: redact(e),
    }),
  );
  return out;
}

export async function deleteAccount(
  orgId: string,
  mode: "live" | "test",
  id: string,
): Promise<void> {
  const row = await findLive(orgId, mode, id);
  await wipe(row, { deleted_at: new Date().toISOString() });
  await releaseBlueskyOAuth(row).catch((e) =>
    logger.warn("account.oauth_release_failed", {
      account_id: id,
      error: redact(e),
    }),
  );
}
