import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],
  // No `experimental.optimizePackageImports` entry on purpose: lucide-react is on Next's built-in
  // list, and hugeicons-react is already tree-shaken by Turbopack (measured: only the icons in use
  // reach the client; adding it changed neither size nor compile time). See docs/BUNDLE.md.
  // Opt-in only: `BUNDLE_SOURCEMAPS=1 npm run build` emits .js.map files next to the client
  // chunks so `node scripts/check-bundle.mjs --by-package` can attribute bytes to packages.
  // Never on by default (maps are served publicly and slow the build). See docs/BUNDLE.md.
  productionBrowserSourceMaps: process.env.BUNDLE_SOURCEMAPS === "1",
};

export default nextConfig;
