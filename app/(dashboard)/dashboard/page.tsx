import { PageHeader } from "@/components/page-header";
import { StatusChip, type Tone } from "@/components/status-chip";
import { Badge } from "@/components/ui/badge";
import { PLANS, planOf } from "@/lib/billing/plans";
import { monthlyPostCount, monthRange } from "@/lib/billing/usage";
import { PICKED_OR } from "@/lib/connect/unpicked";
import { isApprovalLimited } from "@/lib/db/queries/approvals";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { createServerSupabase } from "@/lib/db/server";
import { PLATFORM_LABELS } from "@/lib/platforms/labels";
import type { Platform } from "@/lib/platforms/types";
import { type ModeProps, parseMode } from "./mode";

type ApprovalStatus = NonNullable<Parameters<typeof isApprovalLimited>[0]>;

const APPROVAL: Record<ApprovalStatus, [Tone, string]> = {
  not_needed: ["ok", "Not needed"],
  approved: ["ok", "Approved"],
  in_progress: ["pending", "In progress"],
  not_started: ["off", "Not started"],
  rejected: ["error", "Rejected"],
};

export default async function OverviewPage({ searchParams }: ModeProps) {
  const mode = parseMode((await searchParams).mode);
  const { orgId } = await getCurrentOrg();
  const supabase = await createServerSupabase();
  const month = new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);
  const [{ data: org }, { data: approvals }, { count: accounts }, used] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("name, plan")
        .eq("id", orgId)
        .single(),
      supabase
        .from("platform_approvals")
        .select("platform, status")
        .order("platform"),
      supabase
        .from("social_accounts_public")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("mode", mode)
        .eq("status", "connected")
        .is("deleted_at", null)
        .or(PICKED_OR),
      monthlyPostCount(orgId, start, end),
    ]);
  const plan = PLANS[planOf(org?.plan)];
  const rows = [
    ["Posts this month", `${used} / ${plan.postsPerMonth}`],
    [
      "Connected accounts",
      `${accounts ?? 0} / ${plan.accountsMax ?? "unlimited"}`,
    ],
  ];
  return (
    <>
      <PageHeader
        title={org?.name ?? "Overview"}
        summary={`Overview of your ${mode} workspace.`}
      />
      <section aria-labelledby="usage">
        <h2 id="usage" className="mb-2 text-sm font-medium">
          Usage
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-lg border p-4">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-2xl font-semibold tabular-nums break-words">
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Posts count live published posts only. Plan: {planOf(org?.plan)}.
        </p>
      </section>
      <section aria-labelledby="approvals">
        <h2 id="approvals" className="mb-2 text-sm font-medium">
          Platform approvals
        </h2>
        {(approvals ?? []).length === 0 ? (
          <p className="text-muted-foreground">No platforms listed.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {(approvals ?? []).map((a) => {
              const [tone, label] = APPROVAL[a.status as ApprovalStatus] ?? [
                "off",
                a.status,
              ];
              return (
                <li
                  key={a.platform}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3"
                >
                  <span className="font-medium">
                    {PLATFORM_LABELS[a.platform as Platform] ?? a.platform}
                  </span>
                  <span className="flex items-center gap-3">
                    {isApprovalLimited(a.status as ApprovalStatus) && (
                      <Badge variant="outline" className="text-warn">
                        Limited
                      </Badge>
                    )}
                    <StatusChip tone={tone} label={label} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
