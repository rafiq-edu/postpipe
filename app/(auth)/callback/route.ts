import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/db/server";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=1", request.url));
}
