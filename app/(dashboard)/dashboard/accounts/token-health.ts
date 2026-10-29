export type TokenHealth = "ok" | "expiring" | "expired";

const WEEK = 7 * 24 * 3_600_000;

// shortcut: the view hides refresh_token_enc, so an account with a refresh token and no
// refresh expiry is judged by its access token; upgrade by exposing a has_refresh flag.
export function tokenHealth(
  a: {
    status: string;
    token_expires_at: string | null;
    refresh_expires_at: string | null;
  },
  now = Date.now(),
): TokenHealth {
  if (a.status === "expired") return "expired";
  const deadline = a.refresh_expires_at ?? a.token_expires_at;
  if (!deadline) return "ok";
  const left = new Date(deadline).getTime() - now;
  if (left <= 0) return "expired";
  return left <= WEEK ? "expiring" : "ok";
}
