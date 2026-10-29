export type ErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limited"
  | "idempotency_key_reused"
  | "idempotency_key_in_use"
  | "validation_failed"
  | "not_found"
  | "unknown_social_account"
  | "account_reauth_required"
  | "post_locked"
  | "plan_limit_reached"
  | "account_limit_reached"
  | "invalid_state"
  | "session_expired"
  | "media_unreachable"
  | "daily_quota_reached"
  | "duplicate_post"
  | "board_required"
  | "image_not_jpeg"
  | "caption_too_long"
  | "video_too_long"
  | "too_many_media"
  | "invalid_signature"
  | "platform_not_available";

export const ERROR_CODES = [
  "missing_api_key",
  "invalid_api_key",
  "rate_limited",
  "idempotency_key_reused",
  "idempotency_key_in_use",
  "validation_failed",
  "not_found",
  "unknown_social_account",
  "account_reauth_required",
  "post_locked",
  "plan_limit_reached",
  "account_limit_reached",
  "invalid_state",
  "session_expired",
  "media_unreachable",
  "daily_quota_reached",
  "duplicate_post",
  "board_required",
  "image_not_jpeg",
  "caption_too_long",
  "video_too_long",
  "too_many_media",
  "invalid_signature",
  "platform_not_available",
] as const;

type MissingCode = Exclude<ErrorCode, (typeof ERROR_CODES)[number]>;
const _allCodesListed: MissingCode extends never ? true : never = true;
void _allCodesListed;

// No parameter properties: the worker runs under Node type stripping (erasable syntax only).
export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  detail: string;
  extra?: Record<string, unknown>;
  constructor(
    status: number,
    code: ErrorCode,
    detail: string,
    extra?: Record<string, unknown>,
  ) {
    super(detail);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

const HEADERS = { "content-type": "application/problem+json" };

export function problem(
  status: number,
  code: ErrorCode,
  detail: string,
  extra?: Record<string, unknown>,
): Response {
  const text = code.replaceAll("_", " ");
  const title = text.charAt(0).toUpperCase() + text.slice(1);
  return new Response(
    JSON.stringify({
      type: `https://postpipe.com/errors/${code}`,
      title,
      status,
      detail,
      code,
      ...extra,
    }),
    { status, headers: HEADERS },
  );
}

export function problemFromError(e: unknown): Response {
  if (e instanceof ApiError)
    return problem(e.status, e.code, e.detail, e.extra);
  // 500s carry no ErrorCode and never the original message
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Internal error",
      status: 500,
      detail: "Internal error",
    }),
    { status: 500, headers: HEADERS },
  );
}
