import {
  type ApiKeyLookup,
  findApiKeyByHash,
  touchApiKey,
} from "../db/queries/api-keys";
import { ApiError } from "./errors";
import { API_KEY_RE, hashApiKey } from "./keys";

export { API_KEY_RE, generateApiKey, hashApiKey } from "./keys";
export type { ApiKeyLookup };

export async function authenticate(
  req: Request,
  lookup: (hash: string) => Promise<ApiKeyLookup | null> = findApiKeyByHash,
  touch: (id: string) => Promise<void> = touchApiKey,
): Promise<{ orgId: string; apiKeyId: string; mode: "live" | "test" }> {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token)
    throw new ApiError(
      401,
      "missing_api_key",
      "Send Authorization: Bearer pp_live_... or pp_test_...",
    );
  const invalid = () =>
    new ApiError(401, "invalid_api_key", "API key is invalid or revoked");
  const m = API_KEY_RE.exec(token);
  if (!m) throw invalid();
  const mode = m[1] as "live" | "test";
  const row = await lookup(hashApiKey(token));
  if (!row || row.revoked_at || row.mode !== mode) throw invalid();
  void touch(row.id).catch(() => {});
  return { orgId: row.org_id, apiKeyId: row.id, mode };
}
