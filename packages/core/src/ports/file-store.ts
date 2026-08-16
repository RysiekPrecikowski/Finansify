/**
 * Where a `put()` landed. `url` is the one Blob-specific detail this port
 * leaks — kept because the review screen (its own ticket) plausibly wants to
 * let a user re-download what they uploaded, and refusing to carry a URL
 * forward would just mean reconstructing one from `key` later against
 * whatever the swapped-in implementation happens to be. `key` is the only
 * field anything writes to the database (`import_batches.blob_key`).
 */
export interface StoredFile {
  readonly key: string;
  readonly url: string;
}

/**
 * Outbound port for raw uploaded files — statement exports go to Blob
 * (private), never the database (`docs/domain.md`, "Imports"). `bytes` is
 * `Uint8Array`, matching `RawFile` in `statement-parser.ts` and for the same
 * reason: `packages/core`'s DOM-free build target has no `Blob` to type
 * against.
 */
export interface FileStore {
  put(key: string, bytes: Uint8Array): Promise<StoredFile>;
}
