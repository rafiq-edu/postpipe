import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // a test server needs its own folder: next dev locks the dist dir, so a running `pnpm dev` would block it
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // the dev badge would cover the live/test switch at the bottom of the side nav
  devIndicators: { position: "bottom-right" },
  rewrites: async () => [
    { source: "/v1/:path*", destination: "/api/v1/:path*" },
  ],
};

export default createMDX()(nextConfig);
