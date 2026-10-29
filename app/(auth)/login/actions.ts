"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/db/server";

const callback = () => `${process.env.NEXT_PUBLIC_APP_URL}/callback`;

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback() },
  });
  redirect(error ? "/login?error=1" : "/login?sent=1");
}

export async function signInWithGoogle() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback() },
  });
  redirect(error || !data.url ? "/login?error=1" : data.url);
}
