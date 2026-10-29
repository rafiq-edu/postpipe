import { PublishError } from "../types";

export type Fetch = typeof fetch;

export const PUBLIC_API = "https://public.api.bsky.app";
export const VIDEO_API = "https://video.bsky.app";

const AUTH_ERRORS = new Set([
  "ExpiredToken",
  "InvalidToken",
  "AuthenticationRequired",
]);

// Error codes we handle. Any other platform code becomes http_<status>, so remote text never reaches us.
const KNOWN_ERRORS = new Set([
  ...AUTH_ERRORS,
  "RateLimitExceeded",
  "RecordAlreadyExists",
  "BlobTooLarge",
  "InvalidRequest",
  "InvalidSwap",
  "PayloadTooLarge",
  "UploadLimitExceeded",
]);

/** SSRF guard: hosts come from the user, so never follow a redirect. */
export async function guardedFetch(
  f: Fetch,
  url: URL | string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await f(url, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))
    throw new PublishError(
      "redirect_blocked",
      "permanent",
      "server answered with a redirect",
    );
  return res;
}

// bluesky.md section 5: header names are UNVERIFIED, so read both known forms.
function retryAfterMs(h: Headers): number | undefined {
  const reset = Number(h.get("ratelimit-reset"));
  if (reset > 0) return Math.max(0, reset * 1000 - Date.now());
  const after = Number(h.get("retry-after"));
  if (after > 0) return after * 1000;
  return undefined;
}

export type XrpcOpts = {
  method?: "GET" | "POST";
  token?: string;
  query?: Record<string, string>;
  json?: unknown;
  body?: Uint8Array;
  contentType?: string;
};

/** One XRPC call. Throws PublishError. Never puts the token in a message. */
export async function xrpc<T>(
  f: Fetch,
  base: string,
  nsid: string,
  o: XrpcOpts = {},
): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, base);
  for (const [k, v] of Object.entries(o.query ?? {}))
    url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let body: BodyInit | undefined;
  if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  } else if (o.body) {
    headers["content-type"] = o.contentType ?? "application/octet-stream";
    body = o.body as BodyInit;
  }
  const res = await guardedFetch(f, url, {
    method: o.method ?? "GET",
    headers,
    body,
  });
  if (res.ok) return (await res.json().catch(() => ({}))) as T;
  const err = (await res.json().catch(() => ({}))) as { error?: unknown };
  const code =
    typeof err.error === "string" && KNOWN_ERRORS.has(err.error)
      ? err.error
      : `http_${res.status}`;
  const message = `${nsid} failed: ${res.status} ${code}`;
  if (res.status === 401 || AUTH_ERRORS.has(code))
    throw new PublishError("auth_failed", "auth", message);
  if (res.status === 429)
    throw new PublishError(
      "rate_limited",
      "retryable",
      message,
      retryAfterMs(res.headers),
    );
  if (res.status >= 500) throw new PublishError(code, "retryable", message);
  throw new PublishError(code, "permanent", message);
}
