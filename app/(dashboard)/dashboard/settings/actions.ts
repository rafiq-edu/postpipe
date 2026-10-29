"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/db/server";

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
