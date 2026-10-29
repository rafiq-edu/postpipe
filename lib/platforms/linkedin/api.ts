import { getSecret } from "../../secrets";
import { PublishError } from "../types";
import { LINKEDIN_VERSION } from "./version";

export type Fetch = typeof fetch;

export const REST = "https://api.linkedin.com/rest"; // linkedin.md section 4
export const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"; // linkedin.md section 3
export const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"; // linkedin.md section 3
export const USERINFO_URL = "https://api.linkedin.com/v2/userinfo"; // linkedin.md section 3, Member URN

/** Read lazily so the app runs without the keys. */
export async function clientCreds(): Promise<{ id: string; secret: string }> {
  return {
    id: await getSecret("LINKEDIN_CLIENT_ID"),
    secret: await getSecret("LINKEDIN_CLIENT_SECRET"),
  };
}

/** Headers required on every /rest call (linkedin.md section 4). */
export const restHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "linkedin-version": LINKEDIN_VERSION,
  "x-restli-protocol-version": "2.0.0",
  "content-type": "application/json",
});

/**
 * Maps a failed response to a PublishError. Messages are fixed and codes are
 * ours: remote text is never copied. linkedin.md names no retry-after header.
 */
export async function failure(
  op: string,
  res: Response,
): Promise<PublishError> {
  const message = `linkedin ${op} failed: ${res.status}`;
  if (res.status === 401)
    return new PublishError("account_reauth_required", "auth", message);
  if (res.status === 429)
    return new PublishError("rate_limited", "retryable", message);
  if (res.status === 403)
    return new PublishError("forbidden", "permanent", message);
  // 409 is a write conflict: retry (linkedin.md section 4, Idempotency).
  if (res.status >= 500 || res.status === 409)
    return new PublishError(`http_${res.status}`, "retryable", message);
  // Detected from the response code field only, never free text (linkedin.md section 9, async processing).
  const body = (await res.json().catch(() => ({}))) as { code?: unknown };
  if (body.code === "MEDIA_ASSET_WAITING_UPLOAD")
    return new PublishError("media_not_ready", "retryable", message);
  return new PublishError(`http_${res.status}`, "permanent", message);
}

export async function raw(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const res = await f(url, { ...init, redirect: "manual" });
  if (!res.ok) throw await failure(op, res);
  return res;
}

export async function call<T>(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit,
): Promise<T> {
  const res = await raw(f, op, url, init);
  return (await res.json().catch(() => ({}))) as T;
}
