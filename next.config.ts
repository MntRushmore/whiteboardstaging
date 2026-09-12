import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],
};

export default nextConfig;
