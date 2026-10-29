import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { source } from "@/lib/docs/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{ enabled: false }}
      theme={{ defaultTheme: "light", enableSystem: false }}
    >
      <DocsLayout tree={source.getPageTree()} nav={{ title: <Logo /> }}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
