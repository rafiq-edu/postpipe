import { getSecret } from "../../secrets";
import { PublishError } from "../types";

export type Fetch = typeof fetch;

export const API = "https://api.x.com";
export const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize"; // x.md section 3
export const TOKEN_URL = `${API}/2/oauth2/token`; // x.md section 3
export const REVOKE_URL = `${API}/2/oauth2/revoke`; // x.md section 3

/** Confidential client. Read lazily so the app runs without the keys. */
export async function clientCreds(): Promise<{ id: string; header: string }> {
  const id = await getSecret("X_CLIENT_ID");
  const secret = await getSecret("X_CLIENT_SECRET");
  return {
    id,
    header: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
  };
}

// x-rate-limit-reset is a Unix time in seconds (x.md section 5).
function retryAfterMs(h: Headers): number | undefined {
  const reset = Number(h.get("x-rate-limit-reset"));
  return reset > 0 ? Math.max(0, reset * 1000 - Date.now()) : undefined;
}

/**
 * Maps a failed response to a PublishError. Messages are fixed and codes are
 * ours: remote text is read only to detect the duplicate case, never copied.
 */
export async function failure(
  op: string,
  res: Response,
): Promise<PublishError> {
  const message = `x ${op} failed: ${res.status}`;
  if (res.status === 401)
    return new PublishError("auth_failed", "auth", message);
  if (res.status === 429)
    return new PublishError(
      "rate_limited",
      "retryable",
      message,
      retryAfterMs(res.headers),
    );
  if (res.status >= 500)
    return new PublishError(`http_${res.status}`, "retryable", message);
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    const dup =
      typeof body.detail === "string" && /duplicate content/i.test(body.detail); // x.md section 4, Idempotency
    return new PublishError(
      dup ? "duplicate_post" : "forbidden",
      "permanent",
      message,
    );
  }
  return new PublishError(`http_${res.status}`, "permanent", message);
}

export async function call<T>(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit,
): Promise<T> {
  const res = await f(url, { ...init, redirect: "manual" });
  if (!res.ok) throw await failure(op, res);
  return (await res.json().catch(() => ({}))) as T;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
