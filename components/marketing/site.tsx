import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

export function SiteHeader() {
  return (
    <header className="border-b bg-panel">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4"
      >
        <Link href="/" className="text-lg">
          <Logo />
        </Link>
        <ul className="flex items-center gap-5 text-sm">
          <li>
            <Link href="/docs" className="hover:underline">
              Docs
            </Link>
          </li>
          <li>
            <Link href="/pricing" className="hover:underline">
              Pricing
            </Link>
          </li>
          <li>
            <Link
              href="/login"
              className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90"
            >
              Sign in
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-panel">
      <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-4 px-5 py-8 text-sm text-muted-foreground">
        <Logo />
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li>
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
          </li>
          <li>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
          </li>
          <li>
            <Link href="/data-deletion" className="hover:underline">
              Data deletion
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
