import { checkPlanAllows } from "@/lib/billing/usage";
import {
  type ConnectSession,
  setConnectSessionAccount,
} from "@/lib/db/queries/connect-sessions";
import {
  findAccountByPlatformUser,
  type SocialAccountRow,
  serializeAccount,
  upsertSocialAccount,
} from "@/lib/db/queries/social-accounts";
import type { Json, Platform, TokenSet } from "@/lib/platforms/types";
import { emit } from "@/lib/webhooks/events";

type Profile = {
  platformUserId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
};

/**
 * Shared by the OAuth callback and the app-password action: mode and plan checks,
 * account upsert (tokens stored encrypted), session link, webhook.
 * Returns an error reason for the redirect, or the saved row and the preset target id.
 */
export async function saveConnectedAccount(
  session: ConnectSession,
  tokens: TokenSet,
  profile: Profile,
  /** True when a target pick follows: plan check and created event wait for the pick. */
  pendingPick = false,
  /** Client id of the org's own app used for this connection; null for PostPipe's app. */
  byoClientId: string | null = null,
): Promise<
  | { ok: false; reason: string }
  | { ok: true; row: SocialAccountRow; preset: string | null }
> {
  const existing = await findAccountByPlatformUser(
    session.org_id,
    session.platform as Platform,
    profile.platformUserId,
  );
  if (existing && existing.mode !== session.mode)
    return { ok: false, reason: "mode_conflict" };
  if (
    !pendingPick &&
    session.mode === "live" &&
    (existing?.status !== "connected" || existing.deleted_at)
  ) {
    const chk = await checkPlanAllows(session.org_id, "account");
    if (!chk.ok) return { ok: false, reason: chk.code };
  }

  const { target_id, ...rest } = session.platform_data as Record<string, Json>;
  const preset = typeof target_id === "string" ? target_id : null;
  const row = await upsertSocialAccount({
    orgId: session.org_id,
    mode: session.mode as "live" | "test",
    platform: session.platform as Platform,
    externalId: session.external_id,
    profile,
    tokens,
    platformData: rest,
    byoClientId,
  });
  await setConnectSessionAccount(session, row.id);
  if (!pendingPick)
    await emit(
      session.org_id,
      session.mode as "live" | "test",
      "social.account.created",
      { account: serializeAccount(row) },
    );
  return { ok: true, row, preset };
}
