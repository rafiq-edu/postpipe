"use client";

import { Search } from "lucide-react";
import { useRef } from "react";

const STATUSES = ["pending", "running", "success", "error", "cancelled"];

export function Filters({
  mode,
  tab,
  q,
  status,
}: {
  mode: string;
  tab: string;
  q: string;
  status: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} method="get" className="flex flex-wrap gap-2">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="tab" value={tab} />
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search posts</span>
        <Search
          className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
          aria-hidden
        />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search posts"
          className="h-9 w-full rounded-md border bg-background pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
      <label>
        <span className="sr-only">Status</span>
        <select
          name="status"
          defaultValue={status}
          onChange={() => form.current?.requestSubmit()}
          className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
