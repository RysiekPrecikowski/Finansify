import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

type Sql = ReturnType<typeof postgres>;
type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// Serverless invocations reuse a warm module scope, so cache the connection there.
// Without the global, dev hot-reload opens a new pool on every edit and exhausts the
// free-tier connection limit within minutes.
const globalForDb = globalThis as unknown as { __finansifySql?: Sql; __finansifyDb?: DrizzleDb };

function connect(): DrizzleDb {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  }

  /**
   * `prepare: false` is required, not optional.
   *
   * DATABASE_URL points at Supavisor in transaction mode (port 6543), which does not
   * support prepared statements. postgres-js uses them by default, so without this the
   * app works locally against a direct connection and fails on every query in production.
   */
  const sql = globalForDb.__finansifySql ?? postgres(url, { prepare: false });

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.__finansifySql = sql;
  }

  return drizzle(sql, { schema, casing: 'snake_case' });
}

function getDb(): DrizzleDb {
  const existing = globalForDb.__finansifyDb;
  if (existing) return existing;

  const created = connect();
  globalForDb.__finansifyDb = created;

  return created;
}

/**
 * The connection is opened on first query, not on import.
 *
 * This matters: `next build` imports every server module to prerender, and an
 * import-time connection would fail the build on any machine without DATABASE_URL
 * set -- including CI, which has no database at all.
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver);
  },
});

export type Database = DrizzleDb;
