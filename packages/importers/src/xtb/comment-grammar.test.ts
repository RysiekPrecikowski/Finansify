import { describe, expect, it } from 'vitest';

import { parseTradeComment } from './comment-grammar';

describe('parseTradeComment', () => {
  it('parses a plain OPEN BUY comment', () => {
    const parsed = parseTradeComment('OPEN BUY 10 @ 50.00');

    expect(parsed).not.toBeNull();
    expect(parsed?.quantity.toString()).toBe('10');
    expect(parsed?.price.toString()).toBe('50');
  });

  it('parses a plain CLOSE BUY comment (a sell that closes a long)', () => {
    const parsed = parseTradeComment('CLOSE BUY 4 @ 3.32');

    expect(parsed).not.toBeNull();
    expect(parsed?.quantity.toString()).toBe('4');
    expect(parsed?.price.toString()).toBe('3.32');
  });

  it('parses OPEN SELL and CLOSE SELL the same way', () => {
    expect(parseTradeComment('OPEN SELL 5 @ 20.00')?.quantity.toString()).toBe('5');
    expect(parseTradeComment('CLOSE SELL 5 @ 20.00')?.quantity.toString()).toBe('5');
  });

  it('takes the quantity before the slash on a split fill, not the running total after it', () => {
    const parsed = parseTradeComment('OPEN BUY 2/7.5 @ 51.00');

    expect(parsed?.quantity.toString()).toBe('2');
    expect(parsed?.quantity.toString()).not.toBe('7.5');
    expect(parsed?.price.toString()).toBe('51');
  });

  it('handles a decimal quantity on both sides of the split fill', () => {
    const parsed = parseTradeComment('OPEN BUY 5.5/7.5 @ 51.20');

    expect(parsed?.quantity.toString()).toBe('5.5');
    expect(parsed?.price.toString()).toBe('51.2');
  });

  it('tolerates extra whitespace between tokens', () => {
    const parsed = parseTradeComment('OPEN  BUY   10   @   50.00');

    expect(parsed?.quantity.toString()).toBe('10');
    expect(parsed?.price.toString()).toBe('50');
  });

  it('trims leading and trailing whitespace before matching', () => {
    const parsed = parseTradeComment('   OPEN BUY 10 @ 50.00   ');

    expect(parsed?.quantity.toString()).toBe('10');
  });

  it('returns null, not a throw, for a comment that does not match the grammar at all', () => {
    expect(
      parseTradeComment(
        'eWallet OT|DIR:B2I|BA:1234567|IA:7654321|BR:PLPL|CID:aaaaaaaa-1111-4111-8111-111111111111',
      ),
    ).toBeNull();
  });

  it('returns null for a dividend-style comment', () => {
    expect(parseTradeComment('XTB.PL PLN 0.5000/ SHR')).toBeNull();
  });

  it('returns null for a comment with trailing text after a valid match (grammar is anchored)', () => {
    expect(parseTradeComment('OPEN BUY 10 @ 50.00 extra')).toBeNull();
  });

  it('returns null for an empty comment', () => {
    expect(parseTradeComment('')).toBeNull();
  });
});
