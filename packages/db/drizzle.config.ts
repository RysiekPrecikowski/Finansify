import { defineConfig } from 'drizzle-kit';

// Migrations apply from CI over the unpooled connection — see
// docs/deployment.md. `generate` only diffs the schema against the migrations
// already on disk, so it does not need a live connection; `dbCredentials` is
// read lazily and only matters for `migrate` / `push` / `studio`.
export default defineConfig({
  schema: './src/schema',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? '',
  },
});
