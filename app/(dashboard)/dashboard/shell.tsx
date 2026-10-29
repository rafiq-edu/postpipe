"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { signOut } from "./settings/actions";

type User = { label: string; role: "owner" | "member" };

const Initial = ({ text, round }: { text: string; round?: boolean }) => (
  <span
    aria-hidden="true"
    className={`flex size-6 shrink-0 items-center justify-center bg-muted text-xs font-semibold uppercase ${round ? "rounded-full" : "rounded"}`}
  >
    {text.trim().charAt(0) || "?"}
  </span>
);

function SideMenu({
  orgName,
  user,
  nav,
  docs,
}: {
  orgName: string;
  user: User;
  nav: ReactNode;
  docs: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <Logo className="px-2 pt-1 text-xl" />
      <div className="flex items-center gap-2 rounded-md border bg-panel px-3 py-2 font-medium">
        <Initial text={orgName} />
        <span className="min-w-0 flex-1 truncate">{orgName}</span>
        <ChevronDown
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      {nav}
      <div className="mt-auto flex flex-col gap-1">
        {docs}
        <details className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 hover:bg-muted">
            <Initial text={user.label} round />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-medium" title={user.label}>
                {user.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {user.role === "owner" ? "Owner" : "Member"}
              </span>
            </span>
            <ChevronDown
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </summary>
          <form
            action={signOut}
            className="absolute right-0 bottom-full left-0 mb-1 rounded-md border bg-panel p-1 shadow-sm"
          >
            <button
              type="submit"
              className="w-full rounded px-3 py-1.5 text-left hover:bg-muted"
            >
              Sign out
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}

export function Shell({
  orgName,
  user,
  nav,
  mobileNav,
  docs,
  modeSwitch,
  footer,
  children,
}: {
  orgName: string;
  user: User;
  nav: ReactNode;
  mobileNav: ReactNode;
  docs: ReactNode;
  modeSwitch: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <header className="flex items-center justify-between border-b bg-panel p-3 md:hidden">
        <Logo className="text-lg" />
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="rounded-md border p-2"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      {open && (
        <div className="border-b bg-canvas p-3 md:hidden">
          <SideMenu orgName={orgName} user={user} nav={mobileNav} docs={docs} />
        </div>
      )}
      <aside className="hidden p-4 md:sticky md:top-0 md:block md:h-screen">
        <SideMenu orgName={orgName} user={user} nav={nav} docs={docs} />
      </aside>
      <div className="flex min-w-0 flex-col gap-3 p-3 md:h-screen md:py-4 md:pr-4 md:pl-0">
        <div>{modeSwitch}</div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-panel">
          <main className="min-w-0 flex-1 space-y-8 overflow-y-auto p-4 md:p-6">
            {children}
          </main>
          {footer}
        </div>
      </div>
    </div>
  );
}
