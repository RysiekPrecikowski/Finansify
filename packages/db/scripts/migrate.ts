import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

/**
 * Applies pending migrations, and — unlike `drizzle-kit migrate` — says what
 * went wrong when one fails.
 *
 * `drizzle-kit migrate` exits 1 with no message at all. A production migration
 * broke on 2026-08-16 and the CI log carried nothing but the exit code, so the
 * failure survived three hours and five merges before anyone could name it.
 * A gate that fails illegibly is barely a gate.
 *
 * The other half of that incident is worth stating here, because it decides
 * how you recover rather than how you read the log: **`neon-http` cannot run a
 * multi-statement transaction.** A migration that fails partway leaves the
 * statements that already ran committed, and never records its journal row —
 * so the next run restarts the same file and dies on its first `CREATE TYPE`.
 * The database is then wedged until someone drops the half-created objects by
 * hand. That is the failure the pre-production branch exists to absorb.
 */
const target = process.env.MIGRATION_TARGET ?? 'database';
const url = process.env.DATABASE_URL_UNPOOLED;

if (url === undefined || url === '') {
  console.error(
    `DATABASE_URL_UNPOOLED is not set for ${target}. Migrations need the direct connection, not the pooled one (docs/deployment.md).`,
  );
  process.exit(1);
}

try {
  await migrate(drizzle(neon(url)), { migrationsFolder: './migrations' });
  console.warn(`Migrations applied to ${target}.`);
} catch (error) {
  console.error(`Migration failed against ${target}.`);
  if (error instanceof Error) {
    console.error(error.message);
    // drizzle wraps the driver error; the cause carries what Postgres actually
    // said ("type ... already exists"), which is the line that identifies both
    // the broken migration and whether this is a partial-application wedge.
    const cause = error.cause;
    if (cause instanceof Error) console.error(`Cause: ${cause.message}`);
  } else {
    console.error(String(error));
  }
  process.exit(1);
}
