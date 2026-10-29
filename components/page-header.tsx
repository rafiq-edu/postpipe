import type { ReactNode } from "react";

/** Title, one-line summary, optional action. Shared by every dashboard page. */
export function PageHeader({
  title,
  summary,
  action,
}: {
  title: string;
  summary?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold break-words">{title}</h1>
        {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      </div>
      {action}
    </div>
  );
}
