import { z } from 'zod';

import { type CatalystBondLookup, type CatalystBondTermsRepository } from '../bonds/ports';
import { type InstrumentRepository } from '../ledger/ports';
import { type Instrument } from '../ledger/types';
import { type SymbolRepository } from '../valuation/ports';
import { failure, issuesOf, success, type UseCaseResult } from './result';

export const catalystBondSelectionSchema = z.object({
  ticker: z.string().trim().toUpperCase().min(1).max(32),
});

/**
 * Picking a Catalyst-listed bond, which cannot go through `selectInstrument`
 * (Stage 6). That use case's `confirm()` returns one `symbol`, persisted both
 * as the instrument's own identity and as the provider-mapping identifier —
 * fine when a listing has exactly one identifier, wrong for a Catalyst bond,
 * which has two: the ticker (`instruments.symbol`, what `gpwcatalyst.pl` and
 * `CatalystBondTermsResolver` answer to) and the ISIN (what `gpw`'s price
 * quotes, `chart-json.php`, are keyed by — ADR 0023). This use case writes
 * both explicitly instead of forcing them through one field.
 *
 * It also warms `catalyst_bond_terms` with the nominal `fetchListing`
 * already fetched, so the first valuation of this position does not pay a
 * second request for data this call already has in hand.
 */
export function makeSelectCatalystBond(deps: {
  instruments: InstrumentRepository;
  symbols: SymbolRepository;
  lookup: CatalystBondLookup;
  catalystBondTerms: CatalystBondTermsRepository;
}) {
  return async function selectCatalystBond(input: unknown): Promise<UseCaseResult<Instrument>> {
    const parsed = catalystBondSelectionSchema.safeParse(input);
    if (!parsed.success) return failure(issuesOf(parsed.error));

    const listing = await deps.lookup.fetchListing(parsed.data.ticker);
    if (listing === null) {
      return failure([{ path: 'ticker', message: 'Could not find this bond on Catalyst' }]);
    }

    const instrument = await deps.instruments.findOrCreate({
      symbol: listing.ticker,
      name: `${listing.issuerName} ${listing.ticker}`,
      kind: 'catalyst_bond',
      currency: listing.nominal.currency,
      isin: listing.isin,
      exchange: 'Catalyst',
    });

    await deps.symbols.save({
      instrumentId: instrument.id,
      provider: deps.lookup.name,
      symbol: listing.isin,
      currency: listing.nominal.currency,
      kind: 'catalyst_bond',
    });

    await deps.catalystBondTerms.save(
      { symbol: listing.ticker, nominal: listing.nominal },
      deps.lookup.name,
    );

    return success(instrument);
  };
}
