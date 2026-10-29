import { getSecret } from "../../secrets";
import { PublishError } from "../types";

export type Fetch = typeof fetch;

export const GRAPH_VERSION = "v26.0"; // facebook.md section 3: Debug a token and section 9: pin v26.0
export const GRAPH = "https://graph.facebook.com"; // facebook.md section 4: graph-video.facebook.com is deprecated, use graph.facebook.com
export const API = `${GRAPH}/${GRAPH_VERSION}`;
// UNVERIFIED: facebook.md section 3 gives no authorize URL; this is the usual login dialog.
export const AUTHORIZE_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
export const TOKEN_URL = `${API}/oauth/access_token`; // facebook.md section 3: GET {version}/oauth/access_token
// facebook.md section 4, Reels step 2. Only this host may receive the Reel upload call.
export const RUPLOAD = "https://rupload.facebook.com/video-upload";

/** Read lazily so the app runs without the keys (docs/ops/keys-registry.md: Facebook Pages). */
export async function appCreds(): Promise<{ id: string; secret: string }> {
  return {
    id: await getSecret("META_APP_ID"),
    secret: await getSecret("META_APP_SECRET"),
  };
}

// facebook.md section 5: 4 app, 17 user, 32 Pages request with a User token, 613 custom, 80001 Page BUC.
const RATE_CODES = [4, 17, 32, 613, 80001];

/** Fixed messages and our own codes: remote text is read only to pick a case, never copied. */
export async function failure(
  op: string,
  res: Response,
): Promise<PublishError> {
  const message = `facebook ${op} failed: ${res.status}`;
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
  // facebook.md section 3: OAuthException code 190 (subcodes 458, 460, 463) means the token is invalid.
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
  // A thrown fetch error is replaced: its text must never carry a URL with a token.
  const res = await f(url, { ...init, redirect: "manual" }).catch(() => {
    throw new PublishError(
      "network_error",
      "retryable",
      `facebook ${op} failed: network error`,
    );
  });
  if (!res.ok) throw await failure(op, res);
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * facebook.md shows tokens as parameters only, so the token goes in the form
 * body on POST and in the query on GET. UNVERIFIED for the publish calls.
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
