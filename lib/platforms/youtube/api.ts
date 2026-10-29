import { redact } from "../../log/redact";
import { msToNextMidnight } from "../../publish/quota-day";
import { getSecret } from "../../secrets";
import { PublishError } from "../types";

export type Fetch = typeof fetch;

export const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"; // youtube.md section 3
export const TOKEN_URL = "https://oauth2.googleapis.com/token"; // youtube.md section 3
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke"; // UNVERIFIED: youtube.md section 3 says "call the revoke endpoint" without a URL
export const API = "https://www.googleapis.com/youtube/v3"; // UNVERIFIED: youtube.md names the upload URL only; channels.list lives on the same host
export const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"; // youtube.md section 4
export const WATCH_URL = "https://www.youtube.com/watch?v="; // UNVERIFIED: youtube.md section 4 (Video URL) is not a documented rule
// Only these hosts ever get a token: token, revoke, API and upload.
const UPLOAD_HOST = "www.googleapis.com";
/** Quota day of YouTube: youtube.md section 5, daily quotas reset at midnight Pacific Time. */
export const QUOTA_TZ = "America/Los_Angeles";

/**
 * The session URI comes from a response header and is kept in publish_state, so
 * check it before every use. UNVERIFIED: youtube.md does not show the host of the
 * Location header; the upload host from section 4 is assumed.
 */
export function isUploadSession(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const x = new URL(u);
    return (
      x.protocol === "https:" &&
      x.hostname === UPLOAD_HOST &&
      x.port === "" &&
      x.username === "" &&
      x.password === "" &&
      x.pathname.startsWith("/upload/")
    );
  } catch {
    return false;
  }
}

/** Read lazily so the app runs without the keys (docs/ops/keys-registry.md: YouTube). */
export async function appCreds(): Promise<{ id: string; secret: string }> {
  return {
    id: await getSecret("GOOGLE_CLIENT_ID"),
    secret: await getSecret("GOOGLE_CLIENT_SECRET"),
  };
}

const text = (s: unknown) =>
  String(redact(String(s ?? "").replace(/https?:\/\/\S+/g, "[url]"))).slice(
    0,
    300,
  );

// youtube.md section 4 and 5: reasons the pages list for videos.insert, plus quotaExceeded (UNVERIFIED there).
const REASONS = [
  "quotaExceeded",
  "uploadLimitExceeded",
  "forbiddenPrivacySetting",
  "invalidPublishAt",
  "invalidTitle",
  "invalidTags",
  "mediaBodyRequired",
];
// youtube.md section 5: both mean "try again later"; the quota resets at Pacific midnight.
const QUOTA_REASONS = ["quotaExceeded", "uploadLimitExceeded"];

/** Retry-After in ms (seconds form only), or undefined. */
export const retryAfterMs = (res: Response): number | undefined => {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? s * 1000 : undefined;
};

/**
 * Fixed messages. The reason is shown only when it is on the allowlist, else the
 * code is http_<status>. Platform text (Google host) is shown after URLs are cut,
 * redact and a 300 character cap.
 */
export async function failure(
  op: string,
  res: Response,
  now: Date = new Date(),
): Promise<PublishError> {
  const message = `youtube ${op} failed: ${res.status}`;
  const body = (await res.json().catch(() => ({}))) as {
    error?: unknown;
  };
  const e = body.error;
  const obj = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const errors = Array.isArray(obj.errors) ? obj.errors : [];
  const first = (errors[0] ?? {}) as { reason?: unknown };
  const reason = REASONS.find((r) => r === first.reason);
  // youtube.md section 3: invalid_grant = the refresh token stopped working.
  if (res.status === 401 || e === "invalid_grant")
    return new PublishError("account_reauth_required", "auth", message);
  if (reason && QUOTA_REASONS.includes(reason))
    return new PublishError(
      reason === "quotaExceeded" ? "quota_exceeded" : "upload_limit_exceeded",
      "retryable",
      `${message} (${reason})`,
      msToNextMidnight(now, QUOTA_TZ),
    );
  if (res.status === 429)
    return new PublishError(
      "rate_limited",
      "retryable",
      message,
      retryAfterMs(res),
    );
  if (res.status >= 500)
    return new PublishError(
      `http_${res.status}`,
      "retryable",
      message,
      retryAfterMs(res),
    );
  const detail = text(obj.message ?? (typeof e === "string" ? e : ""));
  const head = reason ? `${message} (${reason})` : message;
  return new PublishError(
    reason ?? `http_${res.status}`,
    "permanent",
    detail ? `${head}: ${detail}` : head,
  );
}

/** One request, no redirects. A thrown fetch error is replaced: its text must not carry a URL. */
export async function send(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return f(url, { ...init, redirect: "manual" }).catch(() => {
    throw new PublishError(
      "network_error",
      "retryable",
      `youtube ${op} failed: network error`,
    );
  });
}

export async function rawCall(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await send(f, op, url, init);
  if (!res.ok) throw await failure(op, res);
  return res;
}

export async function call<T>(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await rawCall(f, op, url, init);
  return (await res.json().catch(() => ({}))) as T;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
