import { createHmac, timingSafeEqual } from "node:crypto";
import { redact } from "../../log/redact";
import { getSecret } from "../../secrets";
import { PublishError } from "../types";
import { TIKTOK_LIMITS } from "./rules";

export type Fetch = typeof fetch;

export const API = "https://open.tiktokapis.com"; // tiktok.md header: API host. The only host that gets a token.
export const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"; // tiktok.md section 3
export const TOKEN_URL = `${API}/v2/oauth/token/`; // tiktok.md section 3
export const REVOKE_URL = `${API}/v2/oauth/revoke/`; // tiktok.md section 3
export const CREATOR_INFO_URL = `${API}/v2/post/publish/creator_info/query/`; // tiktok.md section 4
export const VIDEO_INIT_URL = `${API}/v2/post/publish/video/init/`; // tiktok.md section 4
export const INBOX_INIT_URL = `${API}/v2/post/publish/inbox/video/init/`; // tiktok.md section 4
export const CONTENT_INIT_URL = `${API}/v2/post/publish/content/init/`; // tiktok.md section 4
export const STATUS_URL = `${API}/v2/post/publish/status/fetch/`; // tiktok.md section 4
// UNVERIFIED: tiktok.md section 3 names the path but not the fields; these are the usual ones for user.info.basic.
export const PROFILE_URL = `${API}/v2/user/info/?fields=open_id,display_name,avatar_url`;

/** Read lazily so the app runs without the keys (docs/ops/keys-registry.md: TikTok). */
export async function appCreds(): Promise<{ key: string; secret: string }> {
  return {
    key: await getSecret("TIKTOK_CLIENT_KEY"),
    secret: await getSecret("TIKTOK_CLIENT_SECRET"),
  };
}

/**
 * The upload URL comes from the init response and lives in publish_state, so
 * check it before every use. UNVERIFIED: tiktok.md names no upload host; any
 * https host under tiktokapis.com is accepted. The URL never gets a token.
 */
export function isUploadUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const x = new URL(u);
    return (
      x.protocol === "https:" &&
      x.hostname.endsWith(".tiktokapis.com") &&
      x.port === "" &&
      x.username === "" &&
      x.password === "" &&
      x.pathname.length > 1
    );
  } catch {
    return false;
  }
}

const text = (s: unknown) =>
  String(redact(String(s ?? "").replace(/https?:\/\/\S+/g, "[url]"))).slice(
    0,
    300,
  );

// tiktok.md section 9, Error codes: the codes the pages list. Anything else shows as http_<status>.
const CODES = [
  "invalid_param",
  "scope_not_authorized",
  "spam_risk_too_many_posts",
  "spam_risk_user_banned_from_posting",
  "spam_risk_too_many_pending_share",
  "reached_active_user_cap",
  "unaudited_client_can_only_post_to_private_accounts",
  "url_ownership_unverified",
  "privacy_level_option_mismatch",
  "invalid_publish_id",
  "token_not_authorized_for_specified_publish_id",
  "app_version_check_failed",
];
// tiktok.md section 9, Error codes: both mean the token no longer works.
const AUTH_CODES = ["access_token_invalid", "scope_not_authorized"];

// tiktok.md section 9, Error codes: fail reasons. `internal` is the one marked retry.
export const FAIL_REASONS = [
  "file_format_check_failed",
  "duration_check_failed",
  "frame_rate_check_failed",
  "picture_size_check_failed",
  "video_pull_failed",
  "photo_pull_failed",
  "auth_removed",
  "spam_risk_text",
  "spam_risk",
  "internal",
  "publish_cancelled",
];

/** Retry-After in ms (seconds form only), or undefined. */
export const retryAfterMs = (res: Response): number | undefined => {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? s * 1000 : undefined;
};

/**
 * Fixed messages. The platform code is shown only when it is on the allowlist,
 * else the code is http_<status>. Platform text is shown after URLs are cut,
 * redact and a 300 character cap. `status` 200 = an error inside a 200 reply
 * (tiktok.md section 9: spam_risk_too_many_posts can come as HTTP 200).
 */
export function toError(
  op: string,
  status: number,
  body: unknown,
  retryAfter?: number,
): PublishError {
  const message = `tiktok ${op} failed: ${status}`;
  const b = (body && typeof body === "object" ? body : {}) as {
    error?: unknown;
    error_description?: unknown;
  };
  const e = b.error;
  const obj = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const raw = typeof obj.code === "string" ? obj.code : "";
  // tiktok.md section 3: refresh uses the same endpoint; invalid_grant (OAuth standard, UNVERIFIED in the doc) = the token is dead.
  if (status === 401 || e === "invalid_grant" || AUTH_CODES.includes(raw))
    return new PublishError("account_reauth_required", "auth", message);
  // tiktok.md section 5: over the limit = HTTP 429 rate_limit_exceeded.
  if (status === 429 || raw === "rate_limit_exceeded")
    return new PublishError("rate_limited", "retryable", message, retryAfter);
  if (status >= 500)
    return new PublishError(`http_${status}`, "retryable", message, retryAfter);
  const known = CODES.find((c) => c === raw);
  const detail = text(obj.message ?? b.error_description);
  const code = known ?? (status === 200 ? "api_error" : `http_${status}`);
  const head = known ? `${message} (${known})` : message;
  return new PublishError(
    code,
    "permanent",
    detail ? `${head}: ${detail}` : head,
  );
}

export async function failure(
  op: string,
  res: Response,
): Promise<PublishError> {
  return toError(
    op,
    res.status,
    await res.json().catch(() => ({})),
    retryAfterMs(res),
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
      `tiktok ${op} failed: network error`,
    );
  });
}

/** One API call. An `error.code` other than "ok" fails even on HTTP 200. */
export async function call<T>(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await send(f, op, url, init);
  if (!res.ok) throw await failure(op, res);
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: unknown } | string;
  };
  if (typeof body.error === "string")
    throw toError(op, res.status, body, retryAfterMs(res));
  const code = body.error?.code;
  if (typeof code === "string" && code !== "ok")
    throw toError(op, 200, body, retryAfterMs(res));
  return body as T;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const jsonHeaders = (token: string) => ({
  ...bearer(token),
  "content-type": "application/json; charset=UTF-8", // tiktok.md section 4
});

/**
 * tiktok.md section 6: header `TikTok-Signature: t=<timestamp>,s=<signature>`,
 * s = HMAC-SHA256 of `<timestamp>.<raw body>` keyed with the client secret.
 * UNVERIFIED: hex encoding of s and seconds as the unit of t. The time window is
 * ours (TIKTOK_LIMITS.signatureToleranceMs). Compared on equal-length buffers.
 */
export function verifySignature(
  raw: string,
  header: string | null,
  secret: string,
  nowMs: number,
): boolean {
  const m = /^t=(\d{1,12}),s=([0-9a-fA-F]{64})$/.exec(header ?? "");
  const mac = createHmac("sha256", secret)
    .update(`${m?.[1] ?? ""}.${raw}`)
    .digest();
  const given = Buffer.from(m?.[2] ?? "", "hex");
  const same = given.length === mac.length && timingSafeEqual(given, mac);
  const fresh =
    m !== null &&
    Math.abs(nowMs - Number(m[1]) * 1000) <= TIKTOK_LIMITS.signatureToleranceMs;
  return same && fresh;
}
