import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // core and db ship TypeScript source rather than a build output. This is the
  // whole reason the workspace needs no build orchestrator -- see docs/decisions/0002.
  transpilePackages: ['@finansify/core', '@finansify/db'],
  typedRoutes: true,
};

export default nextConfig;
