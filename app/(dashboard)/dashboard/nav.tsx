"use client";

import {
  BookOpen,
  CreditCard,
  Home,
  KeyRound,
  type LucideIcon,
  Network,
  Settings,
  SquareStack,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { parseMode } from "./mode";

const ITEMS: [string, string, LucideIcon][] = [
  ["Overview", "/dashboard", Home],
  ["Accounts", "/dashboard/accounts", Users],
  ["Posts", "/dashboard/posts", SquareStack],
  ["API keys", "/dashboard/keys", KeyRound],
  ["Webhooks", "/dashboard/webhooks", Network],
  ["Billing", "/dashboard/billing", CreditCard],
  ["Settings", "/dashboard/settings", Settings],
];

const useMode = () => parseMode(useSearchParams().get("mode") ?? undefined);

export function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const mode = useMode();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {ITEMS.map(([label, href, Icon]) => (
        <Link
          key={href}
          href={`${href}?mode=${mode}`}
          onClick={onNavigate}
          aria-current={path === href ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground hover:bg-border/50 hover:text-foreground",
            path === href && "bg-border font-medium text-foreground",
          )}
        >
          <Icon className="size-[18px]" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function DocsLink() {
  return (
    <Link
      href="/docs"
      className="flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground hover:text-foreground"
    >
      <BookOpen className="size-[18px]" aria-hidden="true" />
      Documentation
    </Link>
  );
}

export function ModeSwitch() {
  const path = usePathname();
  const mode = useMode();
  return (
    <div className="flex items-center gap-3">
      <nav
        aria-label="Environment"
        className="flex overflow-hidden rounded-md border bg-panel text-sm"
      >
        {(["live", "test"] as const).map((m) => (
          <Link
            key={m}
            href={`${path}?mode=${m}`}
            aria-current={mode === m ? "true" : undefined}
            className={cn(
              "px-4 py-1.5 capitalize text-muted-foreground",
              mode === m &&
                (m === "test"
                  ? "bg-brand-soft font-medium text-brand-foreground"
                  : "bg-muted font-medium text-foreground"),
            )}
          >
            {m}
          </Link>
        ))}
      </nav>
      <span className="hidden text-muted-foreground sm:inline">
        {mode === "test"
          ? "Test posts do not publish."
          : "Live posts publish for real."}
      </span>
    </div>
  );
}
