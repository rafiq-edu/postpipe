import { checkPlanAllows } from "@/lib/billing/usage";
import type { ConnectSession } from "@/lib/db/queries/connect-sessions";
import { setConnectSessionPicked } from "@/lib/db/queries/connect-sessions";
import {
  findAccountById,
  findAccountByPlatformUser,
  type SocialAccountRow,
  serializeAccount,
  setAccountTargetToken,
} from "@/lib/db/queries/social-accounts";
import type {
  Platform,
  PlatformAdapter,
  Target,
  TokenSet,
} from "@/lib/platforms/types";
import { emit } from "@/lib/webhooks/events";

/**
 * Pick step for adapters with targetToken (Facebook Pages): swaps the
 * connection row for the target's own row. The plan check and the
 * social.account.created event happen here, once, for the final row.
 */
export async function pickTargetWithToken(
  adapter: PlatformAdapter & {
    targetToken: NonNullable<PlatformAdapter["targetToken"]>;
  },
  session: ConnectSession,
  row: SocialAccountRow,
  tokens: TokenSet,
  target: Target,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const dup = await findAccountByPlatformUser(
    row.org_id,
    row.platform as Platform,
    target.id,
  );
  // Same rule as saveConnectedAccount: a new or revived account counts; the temporary connection row does not.
  if (row.mode === "live" && (dup?.status !== "connected" || dup?.deleted_at)) {
    const chk = await checkPlanAllows(row.org_id, "account", row.id);
    if (!chk.ok) return { ok: false, reason: chk.code };
  }
  const pageTokens = await adapter.targetToken(tokens, target.id);
  const saved = await setAccountTargetToken(row.id, target, pageTokens);
  if (!saved.ok) return saved;
  const final = await findAccountById(row.org_id, saved.id);
  if (!final) throw new Error("picked account not found");
  await setConnectSessionPicked(session.id, saved.id);
  await emit(
    row.org_id,
    row.mode as "live" | "test",
    "social.account.created",
    { account: serializeAccount(final) },
  );
  return { ok: true, id: saved.id };
}
