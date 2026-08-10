import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit runs standalone, not through Next.js, so it never auto-loads
 * .env.local the way `next dev`/`next build` do. Load it explicitly.
 */
config({ path: '../../.env.local' });

/**
 * Migrations run against the unpooled connection, not the pooler. The pooler's
 * transaction mode cannot run the multi-statement transactions that migrations
 * need. Runtime queries use the pooler -- see src/client.ts.
 *
 * `DATABASE_URL_UNPOOLED` is Neon's own env var name (set by the Vercel Marketplace
 * integration) -- used as-is rather than renamed, so `vercel env pull` never needs a
 * manual remap.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? '',
  },
  casing: 'snake_case',
});
