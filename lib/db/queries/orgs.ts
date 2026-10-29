import { redirect } from "next/navigation";
import { createServerSupabase } from "../server";

export async function getCurrentOrg(): Promise<{
  orgId: string;
  role: "owner" | "member";
}> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No organization for user");
  return { orgId: data.org_id, role: data.role };
}
