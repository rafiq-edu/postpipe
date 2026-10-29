import { ArrowLeft, Check, CircleAlert, Ellipsis } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LocalTime } from "@/components/local-time";
import { buildTrail, postTitle, shortId } from "@/lib/posts/view";
import { CopyId } from "./copy-id";
import { DB_TO_DISPLAY, StatusLabel } from "./status";

export type DetailTarget = {
  id: string;
  platform: string;
  status: string;
  attempts: number;
  started_at: string | null;
  published_at: string | null;
  platform_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};
export type DetailRun = {
  target_id: string;
  step: string;
  status: string;
  started_at: string;
  finished_at: string | null;
};

const Dot = ({ cls, children }: { cls: string; children: ReactNode }) => (
  <span
    aria-hidden
    className={`relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${cls}`}
  >
    {children}
  </span>
);
const ICON = {
  ok: (
    <Dot cls="bg-ok">
      <Check className="size-3.5" strokeWidth={3} />
    </Dot>
  ),
  error: <Dot cls="bg-destructive">!</Dot>,
  running: (
    <Dot cls="bg-muted-foreground">
      <Ellipsis className="size-3.5" />
    </Dot>
  ),
};

export function Detail({
  post,
  targets,
  runs,
  mode,
  backHref,
}: {
  post: {
    id: string;
    caption: string | null;
    status: string;
    created_at: string;
  };
  targets: DetailTarget[];
  runs: DetailRun[];
  mode: string;
  backHref: string;
}) {
  const groups = buildTrail(post, targets, runs);
  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 rounded-md text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to posts
      </Link>
      <div>
        <h2 className="text-lg font-semibold break-words">
          {postTitle(post.caption)}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="font-mono text-sm text-muted-foreground">
            {shortId(post.id)}
          </code>
          <CopyId id={post.id} />
          <span className="flex-1" />
          <StatusLabel status={DB_TO_DISPLAY[post.status] ?? "pending"} />
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground capitalize">
            {mode}
          </span>
        </div>
      </div>
      <h3 className="text-sm font-semibold">Delivery trail</h3>
      {groups.map((g, i) => {
        const t = targets[i];
        const short = {
          status: t.status,
          code: t.error_code,
          message: t.error_message,
          platform_post_url: t.platform_post_url,
        };
        const full = { ...short, attempts: t.attempts };
        return (
          <section key={g.targetId} className="space-y-3">
            {groups.length > 1 && (
              <h4 className="text-sm font-medium text-muted-foreground">
                {g.platform}
              </h4>
            )}
            <ol>
              {g.entries.map((e, n) => (
                <li
                  key={`${e.label}${e.at}`}
                  className={`relative flex gap-3 pb-4 ${n < g.entries.length - 1 ? "after:absolute after:top-5 after:bottom-0 after:left-2.5 after:w-px after:-translate-x-1/2 after:bg-border" : ""}`}
                >
                  {ICON[e.kind]}
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">
                      {e.label}
                      {e.href && (
                        <>
                          {" "}
                          <a
                            href={e.href}
                            rel="noreferrer"
                            className="font-normal underline underline-offset-2"
                          >
                            View post
                          </a>
                        </>
                      )}
                    </p>
                    <LocalTime
                      iso={e.at}
                      className="text-xs text-muted-foreground"
                    />
                  </div>
                </li>
              ))}
            </ol>
            {t.status === "error" && (
              <div
                role="alert"
                className="flex gap-2 rounded-md bg-danger-soft p-3 text-sm text-destructive"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 break-words">
                  <p className="font-medium">{g.platform} delivery failed</p>
                  <p>
                    {t.error_message}
                    {t.error_code && (
                      <>
                        {" "}
                        <code className="font-mono text-xs">
                          {t.error_code}
                        </code>
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}
            <pre className="max-h-72 overflow-auto rounded-md bg-foreground p-3 font-mono text-xs text-background">
              {JSON.stringify(short, null, 2)}
            </pre>
            <details className="group">
              <summary className="w-fit cursor-pointer rounded-md text-sm underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                View response
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-foreground p-3 font-mono text-xs text-background">
                {JSON.stringify(full, null, 2)}
              </pre>
            </details>
          </section>
        );
      })}
    </div>
  );
}
