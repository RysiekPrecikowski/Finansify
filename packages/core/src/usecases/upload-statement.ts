import { accountIdSchema, type Account } from '../ledger/types';
import { type ScopedLedgerRepository } from '../ledger/ports';
import { type ScopedImportRepository } from '../imports/ports';
import { type ImportBatch } from '../imports/types';
import { type Clock } from '../ports/clock';
import { type FileStore } from '../ports/file-store';
import { type ParsedRow, type RawFile, type StatementParser } from '../ports/statement-parser';

import { failure, success, type UseCaseResult } from './result';

export interface UploadStatementInput {
  readonly accountId: unknown;
  readonly file: RawFile;
}

/**
 * The account is picked from a dropdown; the currency is read out of the
 * file. Nothing before this point compares the two, so picking the wrong one
 * of several accounts at the same broker — the exact case a multi-currency
 * XTB user has, one account per currency — stages a whole statement of
 * amounts against the wrong account, and every number looks right in
 * isolation.
 *
 * A warning rather than a refusal, and worded as one: a currency the account
 * is not denominated in is not on its own wrong (ADR 0021 — an account can
 * hold several currencies natively, e.g. a BOŚ IKZE), so this must not read
 * as an error on a legitimately multi-currency account. It exists for the
 * one case it can actually catch: the wrong account was picked from the
 * dropdown. The parsed rows carry their own currency and are correct as
 * parsed, and the batch is staged for review before anything becomes a
 * `Transaction`. Statement-level, because it is a fact about the pairing of
 * file and account, not about any single row.
 */
function currencyMismatchWarnings(account: Account, rows: readonly ParsedRow[]): readonly string[] {
  const found = [...new Set(rows.map((row) => row.currency))].filter(
    (code) => code !== account.currency,
  );
  if (found.length === 0) return [];

  return [
    `This statement reports amounts in ${found.join(', ')}; the selected account "${account.name}" is denominated in ${account.currency}. ` +
      'If that is a mistake, check that the right account was chosen before accepting these rows.',
  ];
}

/**
 * Upload → sniff → store → parse → stage, as one use case rather than split
 * across a route and several service calls — every step needs the ones
 * before it (there is nothing useful to do with a file `sniff()` refuses, and
 * nothing to store `parse()` against without a stored file's key), so nothing
 * downstream can run the steps out of order or skip the account-ownership
 * check.
 *
 * A `parse()` failure does not throw the whole operation out: the batch row
 * already exists (it was created right after `sniff()` picked a parser), so
 * it moves to `failed` with a reason instead — the upload itself still
 * succeeded, and there is a record of what was tried, per ADR 0015's "never
 * drop a row silently" made whole-batch.
 */
export function makeUploadStatement(deps: {
  ledger: ScopedLedgerRepository;
  imports: ScopedImportRepository;
  fileStore: FileStore;
  parsers: readonly StatementParser[];
  clock: Clock;
}) {
  return async function uploadStatement(
    input: UploadStatementInput,
  ): Promise<UseCaseResult<ImportBatch>> {
    const accountIdResult = accountIdSchema.safeParse(input.accountId);
    if (!accountIdResult.success) {
      return failure([{ path: 'accountId', message: 'Not an account id' }]);
    }

    const accounts = await deps.ledger.listAccounts();
    const account = accounts.find((candidate) => candidate.id === accountIdResult.data);
    if (account === undefined) {
      return failure([{ path: 'accountId', message: 'Unknown account' }]);
    }

    const sniffed = await Promise.all(
      deps.parsers.map(async (parser) => ({ parser, confidence: await parser.sniff(input.file) })),
    );
    const chosen =
      sniffed.find((candidate) => candidate.confidence === 'certain') ??
      sniffed.find((candidate) => candidate.confidence === 'possible');
    if (chosen === undefined) {
      return failure([{ path: 'file', message: 'No registered parser recognizes this file' }]);
    }

    const blobKey = `imports/${account.id}/${deps.clock.now().epochMilliseconds}-${input.file.filename}`;
    const stored = await deps.fileStore.put(blobKey, input.file.bytes);

    const batch = await deps.imports.createBatch({
      accountId: account.id,
      broker: chosen.parser.broker,
      blobKey: stored.key,
    });

    try {
      const parsed = await chosen.parser.parse(input.file);
      await deps.imports.createRows(batch.id, parsed.rows);
      const updated = await deps.imports.markBatchParsed(batch.id, {
        totalRows: parsed.rows.length,
        warnings: [...parsed.warnings, ...currencyMismatchWarnings(account, parsed.rows)],
      });
      return success(updated);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const updated = await deps.imports.markBatchFailed(batch.id, reason);
      return success(updated);
    }
  };
}
