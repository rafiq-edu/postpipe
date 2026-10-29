import { randomUUID } from "node:crypto";
import {
  JoseKey,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
  type OAuthClientOptions,
  type RuntimeLock,
} from "@atproto/oauth-client-node";
import {
  currentKeyVersion,
  decryptToken,
  encryptToken,
} from "../crypto/tokens";
import { createServiceClient } from "../db/client";
import type { SocialAccountRow } from "../db/queries/social-accounts";
import { logger } from "../log/logger";
import { PublishError } from "../platforms/types";
import { getSecret } from "../secrets";
import { assertPublicUrl } from "../webhooks/url-guard";
import { appUrl } from "./oauth";

type Fetch = typeof fetch;

// bluesky.md section 3: `atproto` is required, `transition:generic` is about an app password.
export const BLUESKY_OAUTH_SCOPE = "atproto transition:generic";
const STATE_TTL_MS = 10 * 60_000;
const LOCK_LEASE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const UNIQUE_VIOLATION = "23505";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = () => appUrl().replace(/\/+$/, "");

export function blueskyOAuthMode(): "loopback" | "confidential" {
  const u = new URL(appUrl());
  return u.protocol === "http:" &&
    (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ? "loopback"
    : "confidential";
}

/** The oauth account keeps no real token; this marker fills the `*_enc` column. */
export const blueskyOAuthMarker = (did: string) => `oauth:${did}`;

export function blueskyClientMetadata() {
  const common = {
    client_name: "PostPipe",
    scope: BLUESKY_OAUTH_SCOPE,
    grant_types: ["authorization_code", "refresh_token"] as [
      "authorization_code",
      "refresh_token",
    ],
    response_types: ["code"] as ["code"],
    application_type: "web" as const,
    dpop_bound_access_tokens: true,
  };
  const path = "/api/oauth/bluesky/callback";
  if (blueskyOAuthMode() === "loopback") {
    const port = new URL(appUrl()).port || "80";
    const redirect = `http://127.0.0.1:${port}${path}`;
    return {
      ...common,
      client_id: `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(BLUESKY_OAUTH_SCOPE)}`,
      redirect_uris: [redirect] as [string],
      token_endpoint_auth_method: "none" as const,
    };
  }
  return {
    ...common,
    client_id: `${base()}/oauth/client-metadata.json`,
    jwks_uri: `${base()}/oauth/jwks.json`,
    redirect_uris: [`${base()}${path}`] as [string],
    token_endpoint_auth_method: "private_key_jwt" as const,
    token_endpoint_auth_signing_alg: "ES256",
  };
}

/** SSRF guard for every library request: public hosts only, and a redirect is an error. */
const guarded: Fetch = async (input, init) => {
  const url =
    typeof input === "string" || input instanceof URL
      ? input.toString()
      : input.url;
  await assertPublicUrl(url);
  const res = await fetch(input, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))
    throw new Error("server answered with a redirect");
  return res;
};

const hasCode = (e: unknown, code: string) =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === code;

export const stateStore = {
  async set(key: string, value: NodeSavedState) {
    const db = await createServiceClient();
    const { error } = await db.from("bluesky_oauth_states").upsert({
      key,
      state_enc: await encryptToken(JSON.stringify(value)),
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    });
    if (error) throw error;
  },
  /** Deletes the row as it reads it, so a state works once. */
  async get(key: string) {
    const db = await createServiceClient();
    const { data, error } = await db
      .from("bluesky_oauth_states")
      .delete()
      .eq("key", key)
      .select("state_enc, expires_at")
      .maybeSingle();
    if (error) throw error;
    if (!data || new Date(data.expires_at) <= new Date()) return undefined;
    return JSON.parse(await decryptToken(data.state_enc)) as NodeSavedState;
  },
  async del(key: string) {
    const db = await createServiceClient();
    const { error } = await db
      .from("bluesky_oauth_states")
      .delete()
      .eq("key", key);
    if (error) throw error;
  },
};

export const sessionStore = {
  async set(sub: string, value: NodeSavedSession) {
    const db = await createServiceClient();
    const { error } = await db.from("bluesky_oauth_sessions").upsert({
      sub,
      session_enc: await encryptToken(JSON.stringify(value)),
      key_version: currentKeyVersion(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
  async get(sub: string) {
    const db = await createServiceClient();
    const { data, error } = await db
      .from("bluesky_oauth_sessions")
      .select("session_enc")
      .eq("sub", sub)
      .maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    return JSON.parse(await decryptToken(data.session_enc)) as NodeSavedSession;
  },
  async del(sub: string) {
    const db = await createServiceClient();
    const { error } = await db
      .from("bluesky_oauth_sessions")
      .delete()
      .eq("sub", sub);
    if (error) throw error;
  },
};

/** Lease lock in Postgres. Refresh tokens are single-use (bluesky.md section 3). */
export const requestLock: RuntimeLock = async (name, fn) => {
  const db = await createServiceClient();
  const owner = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  let delay = 25;
  for (;;) {
    const { error } = await db.from("oauth_locks").insert({
      name,
      owner,
      expires_at: new Date(Date.now() + LOCK_LEASE_MS).toISOString(),
    });
    if (!error) break;
    if (!hasCode(error, UNIQUE_VIOLATION)) throw error;
    await db
      .from("oauth_locks")
      .delete()
      .eq("name", name)
      .lt("expires_at", new Date().toISOString());
    if (Date.now() >= deadline) throw new Error("oauth lock timeout");
    await sleep(delay);
    delay = Math.min(delay * 2, 250);
  }
  try {
    return await fn();
  } finally {
    // by owner too: after a lease expiry another holder may own the name now
    await db.from("oauth_locks").delete().eq("name", name).eq("owner", owner);
  }
};

let clientPromise: Promise<NodeOAuthClient> | undefined;

export function getBlueskyOAuthClient(): Promise<NodeOAuthClient> {
  clientPromise ??= (async () => {
    const confidential = blueskyOAuthMode() === "confidential";
    const keyset = confidential
      ? [
          await JoseKey.fromJWK(
            JSON.parse(await getSecret("BLUESKY_OAUTH_PRIVATE_JWK")),
          ),
        ]
      : undefined;
    return new NodeOAuthClient({
      clientMetadata: blueskyClientMetadata(),
      keyset,
      stateStore,
      sessionStore,
      requestLock,
      fetch: guarded as OAuthClientOptions["fetch"],
    });
  })().catch((e) => {
    clientPromise = undefined; // do not cache a failed start
    throw e;
  });
  return clientPromise;
}

/** Test hook: drop the memoized client. */
export function resetBlueskyOAuthClient() {
  clientPromise = undefined;
}

/**
 * A fetch for the Bluesky adapter. Calls to the account's PDS go through the library
 * (DPoP header and refresh); its `Authorization` replaces the adapter's. Other hosts
 * (PLC directory, public API, video service) get a plain call.
 */
export async function blueskyDpopFetch(sub: string): Promise<Fetch> {
  const client = await getBlueskyOAuthClient();
  let session: Awaited<ReturnType<typeof client.restore>>;
  let pds: URL;
  try {
    session = await client.restore(sub);
    pds = new URL((await session.getTokenInfo(false)).aud);
  } catch {
    throw new PublishError(
      "auth_failed",
      "auth",
      "Bluesky session is gone, reconnect the account",
    );
  }
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.origin === pds.origin)
      return session.fetchHandler(url.pathname + url.search, init);
    const headers = new Headers(init?.headers);
    // never send our placeholder to a host that is not the PDS
    if (headers.get("authorization") === `Bearer ${blueskyOAuthMarker(sub)}`)
      headers.delete("authorization");
    return guarded(url, { ...init, headers });
  };
}

/**
 * Revoke the stored session for a DID unless a live OAuth account still uses it
 * (`exceptAccountId` is the account being removed). Best effort.
 */
export async function releaseBlueskyDid(did: string, exceptAccountId?: string) {
  const db = await createServiceClient();
  let q = db
    .from("social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("platform", "bluesky")
    .eq("mode", "live")
    .eq("platform_user_id", did)
    .eq("platform_data->>auth", "oauth")
    .neq("status", "disconnected")
    .is("deleted_at", null);
  if (exceptAccountId) q = q.neq("id", exceptAccountId);
  const { count, error } = await q;
  if (error) throw error;
  if ((count ?? 0) > 0) return;
  try {
    await (await getBlueskyOAuthClient()).revoke(did);
  } catch (e) {
    logger.warn("account.oauth_revoke_failed", {
      code: e instanceof Error ? e.name : "unknown",
    });
  }
  // revoke may fail before it deletes the stored session; make sure it is gone
  await sessionStore.del(did);
}

/** On disconnect or delete of an account. */
export async function releaseBlueskyOAuth(row: SocialAccountRow) {
  const pd = row.platform_data as { auth?: unknown } | null;
  if (row.platform !== "bluesky" || pd?.auth !== "oauth") return;
  await releaseBlueskyDid(row.platform_user_id, row.id);
}
