import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { parseBranding } from "@/lib/connect/branding";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { listPlatformApps } from "@/lib/db/queries/platform-apps";
import { createServerSupabase } from "@/lib/db/server";
import { presignGet } from "@/lib/media/s3";
import { publicPlatforms } from "@/lib/platforms/availability";
import { signOut } from "./actions";
import { BrandingForm } from "./branding-form";
import { PlatformAppsForm } from "./platform-apps-form";

export default async function SettingsPage() {
  const { orgId, role } = await getCurrentOrg();
  const supabase = await createServerSupabase();
  const [{ data: org }, { data: auth }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, branding")
      .eq("id", orgId)
      .single(),
    supabase.auth.getUser(),
  ]);
  const branding = parseBranding(org?.branding);
  const logoUrl = branding.logo_key
    ? await presignGet(branding.logo_key, 3600)
    : null;
  const rows = [
    ["Organization", org?.name],
    ["Organization ID", orgId],
    ["Signed in as", auth.user?.email],
  ];
  return (
    <>
      <PageHeader title="Settings" summary="Your organization and sign-in." />
      <dl className="divide-y rounded-lg border">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all">{v ?? "-"}</dd>
          </div>
        ))}
      </dl>
      <BrandingForm
        name={branding.name ?? ""}
        logoUrl={logoUrl}
        canEdit={role === "owner"}
      />
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Your own platform apps</h2>
        <p className="max-w-prose text-muted-foreground">
          Plug in your own developer app to post through it. Platforms PostPipe
          has not been approved for yet become available to your organisation
          once you add your app.
        </p>
        <PlatformAppsForm
          apps={await listPlatformApps(orgId)}
          callbackBase={(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(
            /\/+$/,
            "",
          )}
          canEdit={role === "owner"}
          publicPlatforms={[...publicPlatforms()]}
        />
      </section>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </>
  );
}
