import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  agentRules: true,
  transpilePackages: ['@finansify/core', '@finansify/db', '@finansify/importers'],
};

export default nextConfig;
