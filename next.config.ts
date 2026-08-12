import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pino', 'pino-pretty', 'thread-stream'],
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
