import { put } from '@vercel/blob';
import { type FileStore } from '@finansify/core';

/**
 * Takes the token as a parameter rather than reading `process.env` itself —
 * same rationale as `createDbClient`: this package has no opinion on where
 * the credential comes from, and the composition root
 * (`apps/web/src/server/container.ts`) is the one place that should know the
 * variable name (`BLOB_IMPORTS_READ_WRITE_TOKEN` — named for the store, not
 * the generic default).
 *
 * `access: 'private'` always — a statement export is financial data, never a
 * publicly-reachable URL (`docs/domain.md`, "Imports"). `addRandomSuffix:
 * false`: the key the use case builds (`imports/<accountId>/<epochMs>-
 * <filename>`) is already unique, and a second, Blob-appended uniqueness
 * suffix would only mean `StoredFile.key` (what actually gets written to
 * `import_batches.blob_key`) stops matching what the caller asked for.
 */
export function createFileStore(token: string): FileStore {
  return {
    async put(key, bytes) {
      const result = await put(key, Buffer.from(bytes), {
        access: 'private',
        token,
        addRandomSuffix: false,
        contentType: 'application/octet-stream',
      });
      return { key: result.pathname, url: result.url };
    },
  };
}
