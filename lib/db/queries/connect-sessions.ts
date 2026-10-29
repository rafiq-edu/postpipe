import { createHash, randomBytes, randomUUID } from "node:crypto";
import { CONNECT_SESSION_TTL_MS } from "../../connect/oauth";
import { encryptToken } from "../../crypto/tokens";
import type { Json, Platform } from "../../platforms/types";
import { createServiceClient } from "../client";
import type { Tables } from "../types";

export type ConnectSession = Tables<"connect_sessions">;

export function hashConnectToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createConnectSession(i: {
  orgId: string;
  mode: "live" | "test";
  platform: Platform;
  externalId: string;
  redirectUrl: string;
  platformData: Record<string, Json>;
}): Promise<{ id: string; token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + CONNECT_SESSION_TTL_MS).toISOString();
  const db = await createServiceClient();
  const { error } = await db.from("connect_sessions").insert({
    id,
    org_id: i.orgId,
    mode: i.mode,
    platform: i.platform,
    external_id: i.externalId,
    redirect_url: i.redirectUrl,
    state: id,
    token_hash: hashConnectToken(token),
    pkce_verifier_enc: await encryptToken(
      randomBytes(32).toString("base64url"),
    ),
    platform_data: i.platformData,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return { id, token, expiresAt };
}

export async function findConnectSessionByToken(
  token: string,
): Promise<ConnectSession | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("connect_sessions")
    .select("*")
    .eq("token_hash", hashConnectToken(token))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findConnectSessionById(
  id: string,
): Promise<ConnectSession | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("connect_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Atomic one-shot claim. Returns false if already used or expired. */
export async function claimConnectSession(id: string): Promise<boolean> {
  const db = await createServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("connect_sessions")
    .update({ used_at: now })
    .eq("id", id)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function setConnectSessionAccount(
  s: ConnectSession,
  accountId: string,
): Promise<void> {
  const db = await createServiceClient();
  const { error } = await db
    .from("connect_sessions")
    .update({
      platform_data: {
        ...(s.platform_data as Record<string, Json>),
        account_id: accountId,
      },
    })
    .eq("id", s.id);
  if (error) throw error;
}

/** Remembers the account a pick produced, so a replayed request can be answered without work. */
export async function setConnectSessionPicked(
  id: string,
  accountId: string,
): Promise<void> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("connect_sessions")
    .select("platform_data")
    .eq("id", id)
    .single();
  if (error) throw error;
  const { error: e2 } = await db
    .from("connect_sessions")
    .update({
      platform_data: {
        ...(data.platform_data as Record<string, Json>),
        picked_account_id: accountId,
      },
    })
    .eq("id", id);
  if (e2) throw e2;
}

export function sessionIsOpen(s: ConnectSession, now = new Date()): boolean {
  return s.used_at === null && new Date(s.expires_at) > now;
}

/** Max wrong app-password tries per connect session. */
export const MAX_CONNECT_FAILURES = 5;

/** Atomically counts one failed login. Returns the new count; the session closes at the max. */
export async function recordConnectFailure(id: string): Promise<number> {
  const db = await createServiceClient();
  const { data, error } = await db.rpc("record_connect_failure", {
    p_session_id: id,
  });
  if (error) throw error;
  return data ?? 0;
}
