import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSecret } from "../secrets";
import type { Database } from "./types";

export const supabaseUrl = () => {
  const v =
    process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set, see docs/ops/keys-registry.md",
    );
  return v;
};

/** Server only. Bypasses RLS; callers must filter by org and mode. */
export async function createServiceClient(): Promise<SupabaseClient<Database>> {
  return createClient<Database>(
    supabaseUrl(),
    await getSecret("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
