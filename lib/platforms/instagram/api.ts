import { getSecret } from "../../secrets";
import { PublishError } from "../types";

export type Fetch = typeof fetch;

export const GRAPH = "https://graph.instagram.com"; // instagram.md Publishing endpoints: Host (Instagram Login)
export const API = `${GRAPH}/v26.0`; // instagram.md Publishing endpoints: current Graph version is v26.0 (S15)
export const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize"; // instagram.md OAuth, step 1
export const TOKEN_URL = "https://api.instagram.com/oauth/access_token"; // instagram.md OAuth, step 3
export const EXCHANGE_URL = `${GRAPH}/access_token`; // instagram.md OAuth, step 5
export const REFRESH_URL = `${GRAPH}/refresh_access_token`; // instagram.md OAuth, Tokens: Refresh

/**
 * Read lazily so the app runs without the keys. instagram.md names no secret
 * keys; Instagram Login has its own app id and secret in the Meta dashboard
 * (UNVERIFIED in the doc), so these are INSTAGRAM_*, not META_*.
 */
export async function appCreds(): Promise<{ id: string; secret: string }> {
  return {
    id: await getSecret("INSTAGRAM_APP_ID"),
    secret: await getSecret("INSTAGRAM_APP_SECRET"),
  };
}

// instagram.md Rate limits: 4 app, 17 user, 32 Pages API, 613 custom, 80002 Instagram BUC.
const RATE_CODES = [4, 17, 32, 613, 80002];

/**
 * Maps a failed response to a PublishError. Messages are fixed and codes are
 * ours: remote text is read only to pick a case, never copied.
 */
export async function failure(
  op: string,
  res: Response,
): Promise<PublishError> {
  const message = `instagram ${op} failed: ${res.status}`;
  if (res.status === 401)
    return new PublishError("account_reauth_required", "auth", message);
  if (res.status === 429)
    return new PublishError("rate_limited", "retryable", message);
  if (res.status >= 500)
    return new PublishError(`http_${res.status}`, "retryable", message);
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: unknown };
  };
  const code = body.error?.code;
  // UNVERIFIED: Meta's OAuthException code 190 means a bad token; instagram.md does not list it.
  if (code === 190)
    return new PublishError("account_reauth_required", "auth", message);
  if (typeof code === "number" && RATE_CODES.includes(code))
    return new PublishError("rate_limited", "retryable", message);
  return new PublishError(`http_${res.status}`, "permanent", message);
}

export async function call<T>(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await f(url, { ...init, redirect: "manual" });
  if (!res.ok) throw await failure(op, res);
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * instagram.md shows `access_token` as a parameter only (OAuth steps 5 and
 * Tokens: Refresh), never an Authorization header, so the token goes in the
 * form body on POST and in the query on GET. UNVERIFIED for the publish calls.
 */
export const postForm = <T>(
  f: Fetch,
  op: string,
  url: string,
  token: string,
  fields: Record<string, string>,
) =>
  call<T>(f, op, url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, access_token: token }),
  });

export const getWithToken = <T>(
  f: Fetch,
  op: string,
  url: string,
  token: string,
  params: Record<string, string> = {},
) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries({ ...params, access_token: token }))
    u.searchParams.set(k, v);
  return call<T>(f, op, u.toString());
};
