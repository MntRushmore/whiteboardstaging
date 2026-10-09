import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/securityHeaders";

/** Where every page lives (`redirects`): the old host sends people here. */
const CANONICAL_ORIGIN = "https://www.agathon.app";

/**
 * The release name of this build (src/lib/release.ts): NEXT_PUBLIC_RELEASE when set by hand, else
 * the commit Vercel is building (short SHA, as the dashboard and GitHub show it), else the local
 * git HEAD, else a build stamp.
 */
function buildRelease(): string {
  if (process.env.NEXT_PUBLIC_RELEASE) return process.env.NEXT_PUBLIC_RELEASE;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return `build-${Date.now().toString(36)}`;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Inlined into server and client code alike, so a browser's error report and the server's log
  // lines name the same release (docs/RUNBOOK-ops.md).
  env: { NEXT_PUBLIC_RELEASE: buildRelease() },
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],
  // No `experimental.optimizePackageImports` entry on purpose: lucide-react is on Next's built-in
  // list, and hugeicons-react is already tree-shaken by Turbopack (measured: only the icons in use
  // reach the client; adding it changed neither size nor compile time). See docs/BUNDLE.md.
  // Opt-in only: `BUNDLE_SOURCEMAPS=1 npm run build` emits .js.map files next to the client
  // chunks so `node scripts/check-bundle.mjs --by-package` can attribute bytes to packages.
  // Never on by default (maps are served publicly and slow the build). See docs/BUNDLE.md.
  productionBrowserSourceMaps: process.env.BUNDLE_SOURCEMAPS === "1",
  // The board's screen strip owns the bottom-left corner; keep the dev badge off it.
  devIndicators: { position: "bottom-right" },
  // Anti-framing and the other headers that cannot break the board (src/lib/securityHeaders.ts).
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
  // One home: www.agathon.app (2026-10-09). A sign-in lives on one origin, so a grown-up who signed
  // in on agathon.app and came back from checkout on the old host looked signed out. Every page on
  // the old host moves for good, query kept; /api still answers there for anything pointed at it.
  async redirects() {
    return [
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "whiteboard.rushilchopra.com" }],
        destination: `${CANONICAL_ORIGIN}/:path`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
