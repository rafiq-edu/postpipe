import { OAuthCallbackError } from "@atproto/oauth-client-node";
import { problem, problemFromError } from "@/lib/api/errors";
import {
  blueskyOAuthMarker,
  getBlueskyOAuthClient,
  releaseBlueskyDid,
} from "@/lib/connect/bluesky-oauth";
import { redirectUrlWith } from "@/lib/connect/redirect";
import { saveConnectedAccount } from "@/lib/connect/save-account";
import {
  type ConnectSession,
  claimConnectSession,
  findConnectSessionById,
  sessionIsOpen,
} from "@/lib/db/queries/connect-sessions";
import { logger } from "@/lib/log/logger";
import { blueskyAdapter } from "@/lib/platforms/bluesky/adapter";

const isUuid = (s: string | null | undefined): s is string =>
  !!s &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const redirectTo = (redirectUrl: string, q: Record<string, string>) =>
  Response.redirect(redirectUrlWith(redirectUrl, q), 302);

const usable = (s: ConnectSession | null): s is ConnectSession =>
  s !== null &&
  s.platform === "bluesky" &&
  s.mode === "live" &&
  (s.platform_data as { auth?: unknown }).auth !== "app_password" &&
  s.redirect_url !== null;

export async function GET(req: Request): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const client = await getBlueskyOAuthClient();
    let done: Awaited<ReturnType<typeof client.callback>>;
    try {
      done = await client.callback(params);
    } catch (e) {
      logger.warn("connect.oauth_callback_failed", {
        code: e instanceof Error ? e.name : "unknown",
      });
      // The connect page URL needs the raw link token, which we do not keep,
      // so errors go to the app's redirect_url like the other platforms.
      const id = e instanceof OAuthCallbackError ? e.state : undefined;
      const s = isUuid(id) ? await findConnectSessionById(id) : null;
      if (usable(s) && s.redirect_url)
        return redirectTo(s.redirect_url, { status: "error", reason: "oauth" });
      return problem(400, "invalid_state", "Unknown or used state");
    }
    const { session: oauth, state } = done;
    const s = isUuid(state) ? await findConnectSessionById(state) : null;
    const did = oauth.did;
    // the library stored a session already: drop it unless a live account uses it
    const drop = () => releaseBlueskyDid(did).catch(() => undefined);
    if (!usable(s) || !s.redirect_url) {
      await drop();
      return problem(400, "invalid_state", "Unknown state");
    }
    if (!sessionIsOpen(s) || !(await claimConnectSession(s.id))) {
      await drop();
      return problem(410, "session_expired", "This connect link has expired");
    }
    try {
      const pds = (await oauth.getTokenInfo(false)).aud;
      // No real token is kept: the library holds the session. The marker fills the
      // encrypted column; token_expires_at stays null so the worker never refreshes it.
      const tokens = {
        accessToken: blueskyOAuthMarker(did),
        scopes: ["atproto", "transition:generic"],
        platformData: { auth: "oauth", did, pds },
      };
      const profile = await blueskyAdapter.getProfile(tokens);
      tokens.platformData = {
        ...tokens.platformData,
        handle: profile.username,
      } as typeof tokens.platformData;
      const saved = await saveConnectedAccount(s, tokens, profile);
      if (!saved.ok) await drop();
      return redirectTo(
        s.redirect_url,
        saved.ok
          ? { status: "success", account_id: saved.row.id }
          : { status: "error", reason: saved.reason },
      );
    } catch (e) {
      logger.warn("connect.oauth_save_failed", {
        session_id: s.id,
        code: e instanceof Error ? e.name : "unknown",
      });
      await drop();
      return redirectTo(s.redirect_url, { status: "error", reason: "oauth" });
    }
  } catch (e) {
    return problemFromError(e);
  }
}
