import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseUrl } from "./client";
import type { Database } from "./types";

/** Dashboard requests: runs as the signed-in user, RLS applies. */
export async function createServerSupabase(): Promise<
  SupabaseClient<Database>
> {
  const store = await cookies();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set, see docs/ops/keys-registry.md",
    );
  return createServerClient<Database>(supabaseUrl(), anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list)
            store.set(name, value, options);
        } catch {
          // called from a Server Component: cookies are read-only there
        }
      },
    },
  });
}
