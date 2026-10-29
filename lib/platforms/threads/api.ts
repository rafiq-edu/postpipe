import { getSecret } from "../../secrets";
import { PublishError } from "../types";

export type Fetch = typeof fetch;

export const GRAPH = "https://graph.threads.com"; // threads.md section 3 and 4
export const API = `${GRAPH}/v1.0`; // threads.md section 4
export const AUTHORIZE_URL = "https://threads.com/oauth/authorize"; // threads.md section 3
export const TOKEN_URL = `${GRAPH}/oauth/access_token`; // threads.md section 3
export const EXCHANGE_URL = `${GRAPH}/access_token`; // threads.md section 3, Short to long-lived
export const REFRESH_URL = `${GRAPH}/refresh_access_token`; // threads.md section 3, Refresh

/** Read lazily so the app runs without the keys. */
export async function appCreds(): Promise<{ id: string; secret: string }> {
  return {
    id: await getSecret("THREADS_APP_ID"),
    secret: await getSecret("THREADS_APP_SECRET"),
  };
}

/**
 * Maps a failed response to a PublishError. Messages are fixed and codes are
 * ours: remote text is read only to detect two cases, never copied.
 */
export async function failure(
  op: string,
  res: Response,
): Promise<PublishError> {
  const message = `threads ${op} failed: ${res.status}`;
  if (res.status === 401)
    return new PublishError("account_reauth_required", "auth", message);
  if (res.status === 429)
    return new PublishError("rate_limited", "retryable", message);
  if (res.status >= 500)
    return new PublishError(`http_${res.status}`, "retryable", message);
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: unknown };
  };
  // UNVERIFIED: Meta's OAuthException code 190 means a bad token; threads.md does not list it.
  if (body.error?.code === 190)
    return new PublishError("account_reauth_required", "auth", message);
  if (JSON.stringify(body).includes("THREADS_API__LINK_LIMIT_EXCEEDED"))
    // threads.md section 4, Limits
    return new PublishError("too_many_links", "permanent", message);
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
 * threads.md only shows `access_token` as a parameter (section 3 and the
 * section 4 example), never an Authorization header, so the token goes in the
 * form body on POST and in the query on GET.
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
