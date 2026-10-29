import { BookOpen } from "lucide-react";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { UuidSchema } from "@/lib/api/schemas/common";
import { getCurrentOrg } from "@/lib/db/queries/orgs";
import { createServerSupabase } from "@/lib/db/server";
import {
  platformLabel,
  postTitle,
  searchFilter,
  shortId,
} from "@/lib/posts/view";
import { parseMode } from "../mode";
import { Detail } from "./detail";
import { Filters } from "./filters";
import {
  DB_TO_DISPLAY,
  DISPLAY_TO_DB,
  type DisplayStatus,
  StatusLabel,
} from "./status";

const PAGE = 50;
type SP = {
  mode?: string;
  tab?: string;
  q?: string;
  status?: string;
  post?: string;
  before?: string;
};

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const mode = parseMode(sp.mode);
  const tab = sp.tab === "errors" ? "errors" : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const status = (sp.status && sp.status in DISPLAY_TO_DB ? sp.status : "") as
    | DisplayStatus
    | "";
  const sel = UuidSchema.safeParse(sp.post);
  const postId = sel.success ? sel.data : null;

  const { orgId } = await getCurrentOrg();
  const supabase = await createServerSupabase();

  const allowed = status ? DISPLAY_TO_DB[status] : null;
  const SEL = "id, caption, status, created_at, social_post_targets(platform)";
  const scoped = <S extends string>(sel: S) => {
    let r = supabase
      .from("social_posts")
      .select(sel)
      .eq("org_id", orgId)
      .eq("mode", mode)
      .order("created_at", { ascending: false })
      .limit(PAGE + 1);
    if (allowed) r = r.in("status", allowed);
    if (q) r = r.or(searchFilter(q));
    if (sp.before) r = r.lt("created_at", sp.before);
    return r;
  };

  // Errors = post failed/partial, or has a target in error. Two queries, merged here (no ids in the URL).
  const failedIds = supabase
    .from("social_posts")
    .select("id")
    .eq("org_id", orgId)
    .eq("mode", mode)
    .in("status", ["failed", "partial"])
    .limit(1000);
  const errTargetIds = supabase
    .from("social_post_targets")
    .select("post_id")
    .eq("org_id", orgId)
    .eq("mode", mode)
    .eq("status", "error")
    .limit(1000);
  const allList = scoped(SEL);
  const failedList = scoped(SEL).in("status", ["failed", "partial"]);
  const errList = scoped(`${SEL}, err:social_post_targets!inner(status)`).eq(
    "err.status",
    "error",
  );
  const [a, b, c, d] = await Promise.all([
    tab === "errors" ? failedList : allList,
    tab === "errors" ? errList : Promise.resolve({ data: [], error: null }),
    failedIds,
    errTargetIds,
  ]);
  for (const r of [a, b, c, d]) if (r.error) throw new Error(r.error.message);
  const merged = new Map<string, NonNullable<typeof a.data>[number]>();
  for (const p of [...(a.data ?? []), ...(b.data ?? [])]) merged.set(p.id, p);
  const rows = [...merged.values()]
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, PAGE + 1);
  const posts = rows.slice(0, PAGE);
  const older = rows.length > PAGE ? posts.at(-1)?.created_at : null;
  const errorCount = new Set([
    ...(c.data ?? []).map((r) => r.id),
    ...(d.data ?? []).map((r) => r.post_id),
  ]).size;

  let detail: React.ReactNode = null;
  if (postId) {
    const { data: p } = await supabase
      .from("social_posts")
      .select(
        "id, caption, status, created_at, social_post_targets(id, platform, status, attempts, started_at, published_at, platform_post_url, error_code, error_message, created_at)",
      )
      .eq("org_id", orgId)
      .eq("mode", mode)
      .eq("id", postId)
      .maybeSingle();
    if (p) {
      const targets = [...p.social_post_targets].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      const { data: runs } = targets.length
        ? await supabase
            .from("publish_runs")
            .select("target_id, step, status, started_at, finished_at")
            .eq("org_id", orgId)
            .in(
              "target_id",
              targets.map((t) => t.id),
            )
        : { data: [] };
      detail = (
        <Detail
          post={p}
          targets={targets}
          runs={runs ?? []}
          mode={mode}
          backHref={href({ post: undefined })}
        />
      );
    }
  }

  function href(o: Partial<Record<keyof SP, string | undefined>>) {
    const m = {
      mode,
      tab,
      q,
      status,
      before: sp.before,
      post: postId ?? undefined,
      ...o,
    };
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(m)) {
      if (v && !(k === "tab" && v === "all")) u.set(k, v);
    }
    return `/dashboard/posts?${u}`;
  }

  const filtered = Boolean(q || status);
  const headline =
    errorCount === 0
      ? "No posts need attention."
      : `${errorCount} ${mode} post${errorCount === 1 ? "" : "s"} need${errorCount === 1 ? "s" : ""} attention.`;
  const empty = filtered
    ? "No posts match these filters."
    : tab === "errors"
      ? `No errors in ${mode} mode.`
      : null;
  const tabCls = (on: boolean) =>
    `inline-flex items-center gap-2 border-b-2 px-1 pb-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${on ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Posts"
        summary={headline}
        action={
          <Link
            href="/docs"
            className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <BookOpen className="size-4" aria-hidden /> API reference
          </Link>
        }
      />
      <nav aria-label="Post views" className="flex gap-4 border-b">
        <Link
          href={href({ tab: "all", before: undefined, post: undefined })}
          aria-current={tab === "all" ? "page" : undefined}
          className={tabCls(tab === "all")}
        >
          All posts
        </Link>
        <Link
          href={href({ tab: "errors", before: undefined, post: undefined })}
          aria-current={tab === "errors" ? "page" : undefined}
          className={tabCls(tab === "errors")}
        >
          Errors
          {errorCount > 0 && (
            <span className="rounded-full bg-danger-soft px-1.5 text-xs text-destructive">
              {errorCount}
            </span>
          )}
        </Link>
      </nav>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <Filters mode={mode} tab={tab} q={q} status={status} />
          {posts.length === 0 ? (
            <div className="py-8 text-sm text-muted-foreground">
              {empty ? (
                <p>{empty}</p>
              ) : (
                <>
                  <p>No posts yet.</p>
                  <p>
                    Send your first post with the{" "}
                    <Link href="/docs" className="underline underline-offset-2">
                      API reference
                    </Link>
                    .
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul>
              <li
                aria-hidden
                className="hidden grid-cols-[minmax(0,1fr)_6rem_7rem_4rem] gap-3 px-3 py-2 text-xs text-muted-foreground md:grid"
              >
                <span>Post</span>
                <span>Platform</span>
                <span>Status</span>
                <span>Created</span>
              </li>
              {posts.map((p) => {
                const on = p.id === postId;
                const platforms = [
                  ...new Set(
                    p.social_post_targets.map((t) => platformLabel(t.platform)),
                  ),
                ].join(", ");
                return (
                  <li key={p.id} className="border-t">
                    <Link
                      href={href({ post: p.id })}
                      aria-current={on ? "true" : undefined}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-3 py-3 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 md:grid-cols-[minmax(0,1fr)_6rem_7rem_4rem] ${on ? "bg-muted" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {postTitle(p.caption)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {shortId(p.id)}
                        </span>
                      </span>
                      <span className="hidden truncate text-sm md:block">
                        {platforms || "None"}
                      </span>
                      <StatusLabel
                        status={DB_TO_DISPLAY[p.status] ?? "pending"}
                      />
                      <LocalTime
                        iso={p.created_at}
                        short
                        className="hidden text-sm text-muted-foreground md:block"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {older && (
            <Link
              href={href({ before: older, post: undefined })}
              className="inline-block rounded-md text-sm underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Older
            </Link>
          )}
        </div>
        <aside
          aria-label="Post detail"
          className={
            detail
              ? "fixed inset-0 z-50 overflow-y-auto bg-panel p-4 md:static md:z-auto md:overflow-visible md:border-l md:bg-transparent md:p-0 md:pl-6"
              : "hidden text-sm text-muted-foreground md:block md:border-l md:pl-6"
          }
        >
          {detail ?? "Select a post to see its delivery trail."}
        </aside>
      </div>
    </div>
  );
}
