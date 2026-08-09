import { defineConfig } from 'drizzle-kit';

/**
 * Migrations run against the DIRECT connection (port 5432), not the pooler.
 * Supavisor's transaction mode cannot run the multi-statement transactions
 * that migrations need. Runtime queries use the pooler -- see src/client.ts.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? '',
  },
  casing: 'snake_case',
});
