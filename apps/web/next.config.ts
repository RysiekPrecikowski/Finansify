import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // core and db ship TypeScript source rather than a build output. This is the
  // whole reason the workspace needs no build orchestrator -- see docs/decisions/0002.
  transpilePackages: ['@finansify/core', '@finansify/db'],
  typedRoutes: true,
  // Leave enabled: `next dev` maintains apps/web/AGENTS.md, which tells agents that this
  // Next version diverges from their training data and where to read the real docs.
  // The file is committed and only its BEGIN/END:nextjs-agent-rules block is managed --
  // anything we write outside that block survives regeneration.
  agentRules: true,
};

export default nextConfig;
