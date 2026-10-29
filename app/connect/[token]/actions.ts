"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getBlueskyOAuthClient } from "@/lib/connect/bluesky-oauth";
import { redirectUrlWith } from "@/lib/connect/redirect";
import { saveConnectedAccount } from "@/lib/connect/save-account";
import {
  claimConnectSession,
  findConnectSessionByToken,
  MAX_CONNECT_FAILURES,
  recordConnectFailure,
  sessionIsOpen,
} from "@/lib/db/queries/connect-sessions";
import { logger } from "@/lib/log/logger";
import { blueskyAdapter } from "@/lib/platforms/bluesky/adapter";
import { loginWithAppPassword } from "@/lib/platforms/bluesky/app-password";
import { PublishError, type TokenSet } from "@/lib/platforms/types";

const LoginForm = z.object({
  handle: z.string().trim().min(3).max(253),
  app_password: z.string().min(1).max(64),
});

/**
 * POST-only (server action). The app password lives only in this function:
 * never in a URL, a log line, an error message or a redirect.
 */
export async function connectBlueskyAppPassword(
  token: string,
  formData: FormData,
): Promise<void> {
  const page = `/connect/${encodeURIComponent(token)}`;
  const session = await findConnectSessionByToken(token);
  if (
    session?.platform !== "bluesky" ||
    session.mode !== "live" ||
    !sessionIsOpen(session)
  )
    redirect(page);
  if (session.failed_attempts >= MAX_CONNECT_FAILURES)
    redirect(`${page}?error=locked`);
  const form = LoginForm.safeParse({
    handle: formData.get("handle"),
    app_password: formData.get("app_password"),
  });
  if (!form.success) redirect(`${page}?error=login`);
  const { handle, app_password: appPassword } = form.data;

  let tokens: TokenSet;
  let profile: Awaited<ReturnType<typeof blueskyAdapter.getProfile>>;
  try {
    tokens = await loginWithAppPassword((...a) => fetch(...a), {
      handle,
      appPassword,
    });
    profile = await blueskyAdapter.getProfile(tokens);
  } catch (e) {
    const code = e instanceof PublishError ? e.code : "unknown";
    logger.warn("connect.app_password_failed", {
      session_id: session.id,
      code,
    });
    const wrong =
      e instanceof PublishError &&
      (e.kind === "auth" || e.kind === "permanent");
    if (
      wrong &&
      (await recordConnectFailure(session.id)) >= MAX_CONNECT_FAILURES
    )
      redirect(`${page}?error=locked`);
    redirect(`${page}?error=${wrong ? "login" : "network"}`);
  }

  if (!(await claimConnectSession(session.id))) redirect(page);
  const redirectUrl = session.redirect_url;
  if (redirectUrl === null)
    throw new Error("connect session has no redirect_url");
  const saved = await saveConnectedAccount(session, tokens, profile);
  redirect(
    redirectUrlWith(
      redirectUrl,
      saved.ok
        ? { status: "success", account_id: saved.row.id }
        : { status: "error", reason: saved.reason },
    ),
  );
}

const HandleForm = LoginForm.pick({ handle: true });

/** Starts Bluesky OAuth. The user gives a handle only; the password stays at Bluesky. */
export async function startBlueskyOAuth(
  token: string,
  formData: FormData,
): Promise<void> {
  const page = `/connect/${encodeURIComponent(token)}`;
  const session = await findConnectSessionByToken(token);
  if (
    session?.platform !== "bluesky" ||
    session.mode !== "live" ||
    !sessionIsOpen(session) ||
    (session.platform_data as { auth?: unknown }).auth === "app_password"
  )
    redirect(page);
  const form = HandleForm.safeParse({ handle: formData.get("handle") });
  if (!form.success) redirect(`${page}?error=handle`);

  let url: URL;
  try {
    const client = await getBlueskyOAuthClient();
    url = await client.authorize(form.data.handle, { state: session.id });
  } catch (e) {
    logger.warn("connect.oauth_start_failed", {
      session_id: session.id,
      code: e instanceof Error ? e.name : "unknown",
    });
    redirect(`${page}?error=handle`);
  }
  redirect(url.toString());
}
