import { problem, problemFromError } from "@/lib/api/errors";
import { parseBranding } from "@/lib/connect/branding";
import { CONNECT_SESSION_TTL_MS, callbackUrl } from "@/lib/connect/oauth";
import { pickTargetWithToken } from "@/lib/connect/pick-target";
import { redirectUrlWith } from "@/lib/connect/redirect";
import { saveConnectedAccount } from "@/lib/connect/save-account";
import { decryptToken } from "@/lib/crypto/tokens";
import { createServiceClient } from "@/lib/db/client";
import {
  type ConnectSession,
  claimConnectSession,
  findConnectSessionById,
} from "@/lib/db/queries/connect-sessions";
import {
  byoClientIdOf,
  loadSecretOverrides,
  overridesForAccount,
} from "@/lib/db/queries/platform-apps";
import type { SocialAccountRow } from "@/lib/db/queries/social-accounts";
import {
  findAccountById,
  loadTokenSet,
  setAccountTarget,
} from "@/lib/db/queries/social-accounts";
import { logger } from "@/lib/log/logger";
import { redact } from "@/lib/log/redact";
import { presignGet } from "@/lib/media/s3";
import { keysAvailable } from "@/lib/platforms/availability";
import { PLATFORM_LABELS } from "@/lib/platforms/labels";
import { adapterFor } from "@/lib/platforms/registry";
import type { Json, Platform, Target, TokenSet } from "@/lib/platforms/types";
import { withSecretOverrides } from "@/lib/secrets";

type Route = { params: Promise<{ platform: string }> };

const isUuid = (s: string | null): s is string =>
  s !== null &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const redirectTo = (redirectUrl: string, q: Record<string, string>) =>
  Response.redirect(redirectUrlWith(redirectUrl, q), 302);

const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Hex values match the light tokens in app/globals.css (this page is plain HTML, no Tailwind).
const PICK_CSS = [
  "*{box-sizing:border-box}",
  'body{margin:0;min-height:100vh;padding:16px;background:#f3f5f8;color:#1d1e22;font:16px/1.5 "IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center}',
  "main{width:100%;max-width:384px;margin-top:6vh;background:#fff;border:1px solid #e1e4e9;border-radius:8px;padding:24px}",
  "h1{margin:0 0 20px;font-size:28px;line-height:1.2;font-weight:600}",
  "header{display:flex;align-items:center;gap:12px;margin-bottom:24px}",
  "header img{max-height:40px;width:auto}",
  "header .i{display:flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;border:1px solid #e1e4e9;border-radius:6px;background:#f3f5f8;font-size:14px;font-weight:600}",
  "header p{margin:0;min-width:0;overflow-wrap:anywhere;font-weight:500}",
  "input[type=radio]{accent-color:#1f1f1f}",
  "footer{margin-top:auto;padding-top:24px;display:flex;align-items:center;gap:6px;font-size:12px;color:#6b6f78}",
  "form{display:grid;gap:12px}",
  "label{display:flex;gap:8px;align-items:center;padding:10px 12px;border:1px solid #d4d7dd;border-radius:8px}",
  "button{height:40px;margin-top:8px;border:0;border-radius:8px;background:#1f1f1f;color:#fafafa;font:inherit;font-weight:500;cursor:pointer}",
  "button:focus-visible,input:focus-visible{outline:2px solid #f26b21;outline-offset:2px}",
].join("");

/** Saves the chosen target. Returns the account id, or a redirect reason. */
async function applyTarget(
  adapter: ReturnType<typeof adapterFor>,
  session: ConnectSession,
  row: SocialAccountRow,
  tokens: TokenSet,
  t: Target,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const { targetToken } = adapter;
  if (!targetToken) {
    await setAccountTarget(row.id, t);
    return { ok: true, id: row.id };
  }
  return pickTargetWithToken(
    { ...adapter, targetToken },
    session,
    row,
    tokens,
    t,
  );
}

/** A replayed request after a successful pick: answer with the same account. */
const pickedId = (s: ConnectSession) =>
  (s.platform_data as Record<string, Json>).picked_account_id;

const adapterOf = (s: ConnectSession) =>
  adapterFor(s.mode as "live" | "test", s.platform as Platform);

export async function GET(req: Request, { params }: Route): Promise<Response> {
  try {
    const { platform } = await params;
    const url = new URL(req.url);
    const state = url.searchParams.get("state");
    if (!isUuid(state))
      return problem(400, "invalid_state", "Missing or malformed state");
    const session = await findConnectSessionById(state);
    if (!session) return problem(400, "invalid_state", "Unknown state");
    const adapter = adapterOf(session);
    if (adapter.platform !== platform)
      return problem(
        400,
        "invalid_state",
        "State does not belong to this platform",
      );
    const overrides = await loadSecretOverrides(
      session.org_id,
      session.platform,
    );
    return await withSecretOverrides(overrides, async () => {
      const redirectUrl = session.redirect_url;
      if (redirectUrl === null)
        throw new Error("connect session has no redirect_url");
      const done = pickedId(session);
      if (typeof done === "string")
        return redirectTo(redirectUrl, { status: "success", account_id: done });
      if (!(await claimConnectSession(session.id)))
        return problem(410, "session_expired", "This connect link has expired");

      const error = url.searchParams.get("error");
      if (error !== null) {
        const reason = /^[a-z_]{1,64}$/i.test(error) ? error : "platform_error";
        return redirectTo(redirectUrl, { status: "error", reason });
      }
      const code = url.searchParams.get("code");
      if (!code) return problem(400, "validation_failed", "Missing code");

      // The app may have been removed since the connect page: same gate as there, before any exchange.
      if (
        session.mode === "live" &&
        !keysAvailable(session.platform, overrides)
      )
        return redirectTo(redirectUrl, {
          status: "error",
          reason: "platform_not_available",
        });

      let tokens: Awaited<ReturnType<typeof adapter.exchangeCode>>;
      let profile: Awaited<ReturnType<typeof adapter.getProfile>>;
      try {
        tokens = await adapter.exchangeCode({
          code,
          redirectUri: callbackUrl(adapter.platform),
          codeVerifier: await decryptToken(session.pkce_verifier_enc ?? ""),
        });
        profile = await adapter.getProfile(tokens);
      } catch (e) {
        logger.warn("connect.exchange_failed", {
          session_id: session.id,
          platform: session.platform,
          error: redact(e),
        });
        return redirectTo(redirectUrl, {
          status: "error",
          reason: "exchange_failed",
        });
      }

      const saved = await saveConnectedAccount(
        session,
        tokens,
        profile,
        adapter.targetToken !== undefined,
        session.mode === "live"
          ? byoClientIdOf(session.platform, overrides)
          : null,
      );
      if (!saved.ok)
        return redirectTo(redirectUrl, {
          status: "error",
          reason: saved.reason,
        });
      const { row, preset } = saved;

      if (adapter.listTargets) {
        const targets = await adapter.listTargets(tokens);
        if (preset) {
          const t = targets.find((x) => x.id === preset);
          if (!t)
            return redirectTo(redirectUrl, {
              status: "error",
              reason: "invalid_target",
            });
          const r = await applyTarget(adapter, session, row, tokens, t).catch(
            (e) => {
              logger.warn("connect.target_token_failed", {
                session_id: session.id,
                error: redact(e),
              });
              return { ok: false as const, reason: "exchange_failed" };
            },
          );
          return redirectTo(
            redirectUrl,
            r.ok
              ? { status: "success", account_id: r.id }
              : { status: "error", reason: r.reason },
          );
        } else if (targets.length > 0) {
          const label = PLATFORM_LABELS[session.platform as Platform];
          const db = await createServiceClient();
          const { data: org, error: orgErr } = await db
            .from("organizations")
            .select("name, branding")
            .eq("id", session.org_id)
            .single();
          if (orgErr) throw orgErr;
          const branding = parseBranding(org.branding);
          const displayName = branding.name ?? org.name;
          const logoUrl = branding.logo_key
            ? await presignGet(branding.logo_key, 3600)
            : null;
          const mark = logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(displayName)}" data-testid="brand-logo">`
            : `<span class="i" aria-hidden="true">${escapeHtml(displayName.trim().charAt(0).toUpperCase())}</span>`;
          const brand = `<header>${mark}<p data-testid="brand-name">${escapeHtml(displayName)}</p></header>`;
          const footer = `<footer><svg aria-hidden="true" width="14" height="14" viewBox="0 0 32 32" fill="none" stroke="#f26b21" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 29V6h11a7 7 0 0 1 0 14H11"/><path d="M11 29v-4a5 5 0 0 1 5-5h1"/></svg> Powered by PostPipe</footer>`;
          const radios = targets
            .map(
              (t, i) =>
                `<label><input type="radio" name="target_id" value="${escapeHtml(t.id)}"${i === 0 ? " checked" : ""}> ${escapeHtml(t.name)}</label>`,
            )
            .join("");
          return new Response(
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose a ${escapeHtml(label)}</title><style>${PICK_CSS}</style></head><body><main>${brand}<h1>Choose a ${escapeHtml(label)}</h1><form method="post" action="${escapeHtml(url.pathname)}"><input type="hidden" name="state" value="${session.id}"><input type="hidden" name="account_id" value="${row.id}">${radios}<button type="submit" data-testid="connect-pick">Continue</button></form></main>${footer}</body></html>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
      }
      return redirectTo(redirectUrl, { status: "success", account_id: row.id });
    });
  } catch (e) {
    return problemFromError(e);
  }
}

export async function POST(req: Request, { params }: Route): Promise<Response> {
  try {
    const { platform } = await params;
    const form = await req.formData();
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : null;
    };
    const state = str("state");
    const session = isUuid(state) ? await findConnectSessionById(state) : null;
    if (!session) return problem(400, "invalid_state", "Unknown state");
    const adapter = adapterOf(session);
    if (adapter.platform !== platform)
      return problem(
        400,
        "invalid_state",
        "State does not belong to this platform",
      );
    if (
      session.used_at === null ||
      Date.now() - new Date(session.used_at).getTime() > CONNECT_SESSION_TTL_MS
    )
      return problem(410, "session_expired", "This connect link has expired");
    const done = pickedId(session);
    if (typeof done === "string" && session.redirect_url !== null)
      return redirectTo(session.redirect_url, {
        status: "success",
        account_id: done,
      });
    const accountId = str("account_id");
    const row = isUuid(accountId)
      ? await findAccountById(session.org_id, accountId)
      : null;
    if (!row || row.platform !== session.platform)
      return problem(400, "invalid_state", "Unknown account");
    if ((session.platform_data as Record<string, Json>).account_id !== row.id)
      return problem(400, "validation_failed", "Account does not match");
    const tokens = await loadTokenSet(row);
    if (session.redirect_url === null)
      throw new Error("connect session has no redirect_url");
    const redirectUrl = session.redirect_url;
    // The account keeps the app it was connected with (or PostPipe's), whatever the org has now.
    const overrides = await overridesForAccount(
      row.org_id,
      row.platform,
      row.platform_data,
    ).catch(() => null);
    if (overrides === null)
      return redirectTo(redirectUrl, {
        status: "error",
        reason: "exchange_failed",
      });
    const r = await withSecretOverrides(overrides, async () => {
      const targets = (await adapter.listTargets?.(tokens)) ?? [];
      const t = targets.find((x) => x.id === str("target_id"));
      if (!t) return null;
      return applyTarget(adapter, session, row, tokens, t).catch((e) => {
        logger.warn("connect.target_token_failed", {
          session_id: session.id,
          error: redact(e),
        });
        return { ok: false as const, reason: "exchange_failed" };
      });
    });
    if (r === null) return problem(400, "validation_failed", "Unknown target");
    return redirectTo(
      session.redirect_url,
      r.ok
        ? { status: "success", account_id: r.id }
        : { status: "error", reason: r.reason },
    );
  } catch (e) {
    return problemFromError(e);
  }
}
