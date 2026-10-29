import type { ReactNode } from "react";
import { Suspense } from "react";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { createServerSupabase } from "@/lib/db/server";
import { publicPlatforms } from "@/lib/platforms/availability";
import { PLATFORM_LABELS } from "@/lib/platforms/labels";
import { availablePlatforms } from "@/lib/platforms/registry";
import { DocsLink, ModeSwitch, Nav } from "./nav";
import { Shell } from "./shell";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { orgId, role } = await getCurrentOrg();
  const supabase = await createServerSupabase();
  const [{ data: org }, { data: auth }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).single(),
    supabase.auth.getUser(),
  ]);
  const meta = auth.user?.user_metadata as { name?: string } | undefined;
  const label = meta?.name || auth.user?.email || "Account";
  const open = publicPlatforms();
  const live = availablePlatforms().filter((p) => open.has(p));
  return (
    <Shell
      orgName={org?.name ?? "Organization"}
      user={{ label, role }}
      nav={
        <Suspense>
          <Nav />
        </Suspense>
      }
      mobileNav={
        <Suspense>
          <Nav />
        </Suspense>
      }
      docs={<DocsLink />}
      modeSwitch={
        <Suspense>
          <ModeSwitch />
        </Suspense>
      }
      footer={
        <div className="flex items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {live.map((p) => PLATFORM_LABELS[p]).join(", ")} available now.
          </span>
          <span className="h-3 border-l" />
          <span>
            Other platforms: coming soon, or bring your own app in Settings.
          </span>
        </div>
      }
    >
      {children}
    </Shell>
  );
}
