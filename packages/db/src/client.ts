import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

/**
 * Takes the connection string as a parameter rather than reading `process.env`
 * itself — this package has no opinion on where the string comes from, and the
 * composition root (`apps/web/src/server/container.ts`) is the one place that
 * should know the variable name.
 */
export function createDbClient(connectionString: string) {
  return drizzle({ client: neon(connectionString), schema });
}

export type Database = ReturnType<typeof createDbClient>;
