import { isIP } from "node:net";
import { assertPublicUrl } from "../../webhooks/url-guard";
import { type Json, PublishError, type TokenSet } from "../types";
import { type Fetch, guardedFetch, PUBLIC_API, xrpc } from "./xrpc";

const PLC_DIRECTORY = "https://plc.directory";

export const APP_PASSWORD_SCOPE = "app_password";

type DidDoc = { service?: { id: string; serviceEndpoint?: unknown }[] };

/**
 * SSRF guard: the DID host and the PDS URL come from the user. Only public https hosts.
 * shortcut: DNS is checked here and fetched later, so a rebind in between is possible; pin the IP if that matters.
 */
export async function assertPublicHttps(url: string): Promise<void> {
  try {
    if (new URL(url).protocol !== "https:") throw new Error("not https");
    await assertPublicUrl(url);
  } catch {
    throw new PublishError(
      "pds_not_public",
      "permanent",
      "host is not a public https server",
    );
  }
}

/** Find the user's PDS from their DID document (bluesky.md section 1: do not hard-code bsky.social). */
export async function resolvePds(f: Fetch, did: string): Promise<string> {
  let url: string;
  if (did.startsWith("did:plc:")) url = `${PLC_DIRECTORY}/${did}`;
  else if (did.startsWith("did:web:")) {
    url = `https://${decodeURIComponent(did.slice(8))}/.well-known/did.json`;
    await assertPublicHttps(url);
  } else
    throw new PublishError("bad_did", "permanent", "unsupported DID method");
  const res = await guardedFetch(f, url);
  if (!res.ok)
    throw new PublishError(
      "did_unresolved",
      res.status >= 500 ? "retryable" : "permanent",
      `DID lookup failed: ${res.status}`,
    );
  const doc = (await res.json()) as DidDoc;
  const ep = doc.service?.find(
    (s) => s.id === "#atproto_pds" || s.id.endsWith("#atproto_pds"),
  )?.serviceEndpoint;
  if (typeof ep !== "string")
    throw new PublishError("no_pds", "permanent", "DID has no PDS");
  await assertPublicHttps(ep);
  return ep;
}

export async function resolveHandle(f: Fetch, handle: string): Promise<string> {
  const r = await xrpc<{ did: string }>(
    f,
    PUBLIC_API,
    "com.atproto.identity.resolveHandle",
    { query: { handle } },
  );
  return r.did;
}

// Reads exp (seconds) from a JWT payload. No signature check: we only schedule refreshes.
function jwtExpiry(jwt: string): string | undefined {
  try {
    const p = JSON.parse(
      Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString(),
    ) as { exp?: number };
    return typeof p.exp === "number"
      ? new Date(p.exp * 1000).toISOString()
      : undefined;
  } catch {
    return undefined;
  }
}

type Session = { accessJwt: string; refreshJwt: string; did: string };

function toTokens(s: Session, pds: string): TokenSet {
  const platformData: Record<string, Json> = {
    auth: "app_password",
    did: s.did,
    pds_url: pds,
  };
  return {
    accessToken: s.accessJwt,
    refreshToken: s.refreshJwt,
    // bluesky.md section 3: lifetimes UNVERIFIED, so read them from the JWTs.
    expiresAt: jwtExpiry(s.accessJwt),
    refreshExpiresAt: jwtExpiry(s.refreshJwt),
    scopes: [APP_PASSWORD_SCOPE],
    platformData,
  };
}

/** createSession with handle and app password, on the user's own PDS. */
export async function loginWithAppPassword(
  f: Fetch,
  i: { handle: string; appPassword: string },
): Promise<TokenSet> {
  const handle = i.handle.trim().replace(/^@/, "").toLowerCase();
  if (handle === "localhost" || isIP(handle.replace(/^\[|\]$/g, "")))
    throw new PublishError("bad_handle", "permanent", "handle is not valid");
  const did = handle.startsWith("did:")
    ? handle
    : await resolveHandle(f, handle);
  const pds = await resolvePds(f, did);
  const s = await xrpc<Session>(f, pds, "com.atproto.server.createSession", {
    method: "POST",
    json: { identifier: did, password: i.appPassword },
  });
  return toTokens(s, pds);
}

/** refreshSession with the refresh JWT. The PDS is looked up again, the user may have moved. */
export async function refreshAppPasswordSession(
  f: Fetch,
  t: TokenSet,
): Promise<TokenSet> {
  const did = t.platformData?.did;
  if (typeof did !== "string" || !t.refreshToken)
    throw new PublishError("account_reauth_required", "auth", "no session");
  const pds = await resolvePds(f, did);
  const s = await xrpc<Session>(f, pds, "com.atproto.server.refreshSession", {
    method: "POST",
    token: t.refreshToken,
  });
  return toTokens(s, pds);
}
