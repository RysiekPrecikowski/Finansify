import { transactionInputSchema, transactionShapeOf, transactionTypes } from '@finansify/core';
import { describe, expect, it } from 'vitest';

import { transactionInputFrom } from './transaction-form';

const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const INSTRUMENT_ID = '33333333-3333-4333-8333-333333333333';

const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

function formDataOf(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }
  return formData;
}

// Every assertion here goes through the real schema rather than through a
// hand-written picture of the mapped object: a test that only compared the
// intermediate shape would stay green while `transactionInputSchema` rejected
// the submission for real.
function parse(fields: Record<string, string>) {
  return transactionInputSchema.safeParse(transactionInputFrom(formDataOf(fields)));
}

function issuePaths(result: ReturnType<typeof parse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('transactionInputFrom', () => {
  describe('a fully filled units-shaped row', () => {
    const fields = {
      accountId: ACCOUNT_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'buy',
      tradeDate: '2026-01-15',
      settleDate: '2026-01-17',
      quantity: '100',
      price: '10.50',
      grossAmount: '',
      fee: '9.99',
      tax: '1.23',
      currency: 'PLN',
      fxRate: '',
      fxRateSource: '',
      note: 'First tranche',
    };

    it('parses, and every field arrives with the value that was submitted', () => {
      const result = parse(fields);

      expect(issuePaths(result)).toEqual([]);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).toMatchObject({
        accountId: ACCOUNT_ID,
        instrumentId: INSTRUMENT_ID,
        type: 'buy',
        tradeDate: '2026-01-15',
        settleDate: '2026-01-17',
        quantity: '100',
        price: '10.50',
        grossAmount: null,
        fee: '9.99',
        tax: '1.23',
        currency: 'PLN',
        note: 'First tranche',
      });
    });
  });

  // The single most important case in this file. `z.default()` fires on
  // `undefined` and on nothing else, so `fee: null` is a validation error rather
  // than a zero. An implementation that maps every empty field to `null` — the
  // obvious one to write — fails right here, and must.
  describe('an empty fee or tax', () => {
    const base = {
      accountId: ACCOUNT_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'buy',
      tradeDate: '2026-01-15',
      quantity: '100',
      price: '10.50',
      currency: 'PLN',
    };

    it('is omitted from the mapped object, not sent as null', () => {
      const mapped = transactionInputFrom(formDataOf({ ...base, fee: '', tax: '' }));

      expect(mapped.fee).toBeUndefined();
      expect(mapped.tax).toBeUndefined();
    });

    it('parses, and the schema supplies the zero', () => {
      const result = parse({ ...base, fee: '', tax: '' });

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.fee).toBe('0');
      expect(result.success && result.data.tax).toBe('0');
    });

    // A form need not render a fee box at all, so the key can be missing rather
    // than blank. `FormData.get` answers `null` for both, and both must reach
    // the schema as `undefined`.
    it('behaves the same when the field was never rendered', () => {
      const result = parse(base);

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.fee).toBe('0');
      expect(result.success && result.data.tax).toBe('0');
    });

    it('treats a whitespace-only fee as empty rather than as a value', () => {
      const result = parse({ ...base, fee: '   ', tax: '   ' });

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.fee).toBe('0');
      expect(result.success && result.data.tax).toBe('0');
    });
  });

  describe('a gross-shaped row', () => {
    const deposit = {
      accountId: ACCOUNT_ID,
      type: 'deposit',
      tradeDate: '2026-02-01',
      quantity: '',
      price: '',
      grossAmount: '1000.00',
      currency: 'PLN',
    };

    // `quantity` is the one decimal field that is not nullable, so a gross row —
    // which has no unit leg at all — needs a literal zero rather than a null or
    // a blank.
    it('sends a zero quantity, and parses', () => {
      const mapped = transactionInputFrom(formDataOf(deposit));

      expect(mapped.quantity).toBe('0');

      const result = parse(deposit);

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.quantity).toBe('0');
      expect(result.success && result.data.grossAmount).toBe('1000.00');
      expect(result.success && result.data.price).toBe(null);
    });

    it('carries no instrument when the form rendered no instrument field', () => {
      const result = parse(deposit);

      expect(result.success && result.data.instrumentId).toBe(null);
    });

    // Driven off `transactionShapeOf` rather than a hand-copied list, because the
    // rule is `amount: 'gross'` and not "the types with no instrument" —
    // `dividend` and `coupon` are gross-shaped *and* instrument-required, and an
    // implementation that keys off the wrong column passes the deposit case and
    // fails these two.
    const grossShaped = transactionTypes.filter(
      (type) => transactionShapeOf(type).amount === 'gross',
    );

    it.each(grossShaped)('defaults a blank quantity to zero for %s', (type) => {
      const shape = transactionShapeOf(type);
      const result = parse({
        accountId: ACCOUNT_ID,
        ...(shape.instrument === 'required' ? { instrumentId: INSTRUMENT_ID } : {}),
        type,
        tradeDate: '2026-02-01',
        quantity: '',
        grossAmount: '42.00',
        currency: 'PLN',
      });

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.quantity).toBe('0');
    });
  });

  // The mirror of the case above: a units-shaped row genuinely needs a quantity,
  // so a blank one has to reach the schema and be refused there. Inventing a
  // zero would silently book a buy of nothing.
  it('does not invent a quantity for a units-shaped row that was left blank', () => {
    const result = parse({
      accountId: ACCOUNT_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'buy',
      tradeDate: '2026-01-15',
      quantity: '',
      price: '10.50',
      currency: 'PLN',
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('quantity');
  });

  describe('Polish-style amounts', () => {
    // The mapper routes decimal fields through `normalizeDecimalInput`, so a
    // value typed — or re-submitted after being formatted — the Polish way has to
    // survive all the way into a valid parse.
    it('survives into a valid parse for quantity, price, gross amount, fee and tax', () => {
      const result = parse({
        accountId: ACCOUNT_ID,
        instrumentId: INSTRUMENT_ID,
        type: 'buy',
        tradeDate: '2026-01-15',
        quantity: `1${NO_BREAK_SPACE}000`,
        price: '1 234,56',
        grossAmount: '1 234 560,00',
        fee: '9,99',
        tax: '0,01',
        currency: 'PLN',
      });

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.quantity).toBe('1000');
      expect(result.success && result.data.price).toBe('1234.56');
      expect(result.success && result.data.grossAmount).toBe('1234560.00');
      expect(result.success && result.data.fee).toBe('9.99');
      expect(result.success && result.data.tax).toBe('0.01');
    });

    // An executed rate is a decimal a Polish user types with a comma too, and
    // rule 6 makes it the one number that can never be reconstructed later.
    it('survives into a valid parse for the executed fx rate', () => {
      const result = parse({
        accountId: ACCOUNT_ID,
        instrumentId: INSTRUMENT_ID,
        type: 'buy',
        tradeDate: '2026-01-15',
        quantity: '10',
        price: '100.00',
        currency: 'USD',
        fxRate: '4,0512',
        fxRateSource: 'broker',
      });

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.fxRate).toBe('4.0512');
      expect(result.success && result.data.fxRateSource).toBe('broker');
    });
  });

  describe('empty nullable fields', () => {
    const fields = {
      accountId: ACCOUNT_ID,
      instrumentId: '',
      type: 'deposit',
      tradeDate: '2026-03-01',
      settleDate: '',
      quantity: '',
      price: '',
      grossAmount: '500.00',
      currency: 'PLN',
      fxRate: '',
      fxRateSource: '',
      note: '',
    };

    it('all become null, and parse', () => {
      const result = parse(fields);

      expect(issuePaths(result)).toEqual([]);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).toMatchObject({
        instrumentId: null,
        settleDate: null,
        price: null,
        fxRate: null,
        fxRateSource: null,
        note: null,
      });
    });

    // `note` is `z.string().trim()`, so a whitespace-only note would parse — as
    // the empty string, not as null. Only the mapper can tell the difference
    // between "nothing written" and "spaces written", and it has to answer null.
    it('treats a whitespace-only note as absent rather than as an empty note', () => {
      const result = parse({ ...fields, note: '   ' });

      expect(issuePaths(result)).toEqual([]);
      expect(result.success && result.data.note).toBe(null);
    });
  });

  // Rule 6 lives in `transactionInputSchemaFor(accountCurrency)`, which is the
  // only thing that knows what the account is denominated in. The mapper must
  // not anticipate it: no invented rate, no invented source, no guess at the
  // account currency.
  it('does not invent an fx rate for a foreign-currency row that has none', () => {
    const fields = {
      accountId: ACCOUNT_ID,
      instrumentId: INSTRUMENT_ID,
      type: 'buy',
      tradeDate: '2026-01-15',
      quantity: '10',
      price: '100.00',
      currency: 'USD',
      fxRate: '',
      fxRateSource: '',
    };
    const mapped = transactionInputFrom(formDataOf(fields));

    expect(mapped.fxRate).toBe(null);
    expect(mapped.fxRateSource).toBe(null);

    const result = parse(fields);

    expect(issuePaths(result)).toEqual([]);
    expect(result.success && result.data.currency).toBe('USD');
    expect(result.success && result.data.fxRate).toBe(null);
  });

  // `FormData.get` is typed `string | File | null`. A file entry cannot happen
  // from this form, but the mapper is handed whatever the request body carried,
  // and a crash in a server action is a 500 rather than a field error.
  it('does not crash on a non-string entry, and treats it as absent', () => {
    const formData = formDataOf({
      accountId: ACCOUNT_ID,
      type: 'deposit',
      tradeDate: '2026-03-01',
      quantity: '',
      grossAmount: '500.00',
      currency: 'PLN',
    });
    formData.append('note', new File(['not a note'], 'note.txt', { type: 'text/plain' }));

    expect(() => transactionInputFrom(formData)).not.toThrow();

    const result = transactionInputSchema.safeParse(transactionInputFrom(formData));

    expect(issuePaths(result)).toEqual([]);
    expect(result.success && result.data.note).toBe(null);
  });
});
