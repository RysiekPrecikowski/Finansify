import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  agentRules: true,
  transpilePackages: ['@finansify/core', '@finansify/db'],
};

export default nextConfig;
