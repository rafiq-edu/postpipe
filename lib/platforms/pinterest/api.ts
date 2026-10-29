import { redact } from "../../log/redact";
import { getSecret, MissingSecret } from "../../secrets";
import { type Json, PublishError } from "../types";

export type Fetch = typeof fetch;

const PROD = "https://api.pinterest.com/v5"; // pinterest.md section 1: Base URL
const SANDBOX = "https://api-sandbox.pinterest.com/v5"; // pinterest.md section 2: Sandbox base URL
export const AUTHORIZE_URL = "https://www.pinterest.com/oauth/"; // pinterest.md section 3
export const PIN_URL = "https://www.pinterest.com/pin/"; // UNVERIFIED: pinterest.md section 4 (Pin URL) gives no URL field

export type ApiEnv = "sandbox" | "production";

/**
 * pinterest.md section 2: Trial uses the sandbox host with a separate token, and
 * the two never mix. So an account keeps the env that issued its token
 * (platformData.api_env). Only without it is PINTEREST_ENV read: unset, empty or
 * "production" = production, "sandbox" = sandbox, anything else is a config error.
 */
export async function apiEnv(
  platformData?: Record<string, Json>,
): Promise<ApiEnv> {
  const own = platformData?.api_env;
  if (own === "sandbox" || own === "production") return own;
  const raw = await getSecret("PINTEREST_ENV").catch((e) => {
    if (e instanceof MissingSecret) return "";
    throw e;
  });
  const env = raw.trim().toLowerCase();
  if (env === "" || env === "production") return "production";
  if (env === "sandbox") return "sandbox";
  throw new PublishError(
    "config_error",
    "permanent",
    "PINTEREST_ENV must be sandbox or production",
  );
}

/** Only these two hosts ever get a token. */
export const baseUrl = async (platformData?: Record<string, Json>) =>
  (await apiEnv(platformData)) === "sandbox" ? SANDBOX : PROD;

/** Read lazily so the app runs without the keys (docs/ops/keys-registry.md: Pinterest). */
export async function appCreds(): Promise<{ id: string; basic: string }> {
  const id = await getSecret("PINTEREST_APP_ID");
  const secret = await getSecret("PINTEREST_APP_SECRET");
  // pinterest.md section 3: Authorization: Basic base64(client_id:client_secret)
  return {
    id,
    basic: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
  };
}

const text = (s: unknown) =>
  String(redact(String(s ?? "").replace(/https?:\/\/\S+/g, "[url]"))).slice(
    0,
    300,
  );

/**
 * Fixed messages. Platform text (api.pinterest.com is a fixed trusted host) is
 * shown only after URLs are cut, redact and a 300 character cap.
 */
export async function failure(
  op: string,
  res: Response,
): Promise<PublishError> {
  const message = `pinterest ${op} failed: ${res.status}`;
  const body = (await res.json().catch(() => ({}))) as {
    code?: unknown;
    message?: unknown;
  };
  // pinterest.md section 3: an expired or bad token gives HTTP 401, error code 2.
  if (res.status === 401 || body.code === 2)
    return new PublishError("account_reauth_required", "auth", message);
  if (res.status === 429) {
    // pinterest.md section 5: 429 = too many requests; use x-ratelimit-reset. UNVERIFIED: the unit (seconds assumed).
    const s = Number(res.headers.get("x-ratelimit-reset"));
    return new PublishError(
      "rate_limited",
      "retryable",
      message,
      Number.isFinite(s) && s > 0 ? s * 1000 : undefined,
    );
  }
  if (res.status >= 500)
    return new PublishError(`http_${res.status}`, "retryable", message);
  const detail = text(body.message);
  return new PublishError(
    `http_${res.status}`,
    "permanent",
    detail ? `${message}: ${detail}` : message,
  );
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

export async function rawCall(
  f: Fetch,
  op: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  // A thrown fetch error is replaced: its text must not carry a URL.
  const res = await f(url, { ...init, redirect: "manual" }).catch(() => {
    throw new PublishError(
      "network_error",
      "retryable",
      `pinterest ${op} failed: network error`,
    );
  });
  if (!res.ok) throw await failure(op, res);
  return res;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
