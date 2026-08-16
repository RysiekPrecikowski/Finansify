import { describe, expect, it } from 'vitest';

import { Temporal } from '../time';
import { InvalidSeriesCodeError, parseSeriesCode, redemptionDateFor } from './series-code';

describe('parseSeriesCode', () => {
  it('decomposes a code into its family and redemption month', () => {
    const parsed = parseSeriesCode('EDO0836');

    expect(parsed.code).toBe('EDO0836');
    expect(parsed.family).toBe('EDO');
    expect(parsed.redemptionMonth.toString()).toBe('2036-08');
  });

  it('accepts the eight families that are actually issued', () => {
    for (const code of [
      'OTS1126',
      'ROR0827',
      'DOR0828',
      'TOS0829',
      'COI0830',
      'ROS0832',
      'EDO0836',
      'ROD0838',
    ]) {
      expect(() => parseSeriesCode(code)).not.toThrow();
    }
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(parseSeriesCode('  edo0836 ').code).toBe('EDO0836');
  });

  it('rejects a family Finansify has no rules for', () => {
    // DOS and TOZ are real historical series, but nobody can buy one and no
    // rules exist for them — better to refuse than to value one wrongly.
    expect(() => parseSeriesCode('DOS0817')).toThrow(InvalidSeriesCodeError);
  });

  it.each(['EDO083', 'EDO08366', 'ED0836', '0836EDO', '', 'EDO0836X'])(
    'rejects %s as malformed',
    (value) => {
      expect(() => parseSeriesCode(value)).toThrow(InvalidSeriesCodeError);
    },
  );

  it('rejects a month that is not a month', () => {
    expect(() => parseSeriesCode('EDO1336')).toThrow(InvalidSeriesCodeError);
    expect(() => parseSeriesCode('EDO0036')).toThrow(InvalidSeriesCodeError);
  });
});

describe('redemptionDateFor', () => {
  it('adds the family tenor to the purchase, not to the series code', () => {
    expect(redemptionDateFor(Temporal.PlainDate.from('2026-08-01'), 120).toString()).toBe(
      '2036-08-01',
    );
    expect(redemptionDateFor(Temporal.PlainDate.from('2026-08-15'), 12).toString()).toBe(
      '2027-08-15',
    );
  });

  it('constrains onto the last day when the target month is shorter', () => {
    // The case the published ROR table exercises: bought 31 August, first
    // period ends 30 September because September has no 31st.
    expect(redemptionDateFor(Temporal.PlainDate.from('2026-08-31'), 1).toString()).toBe(
      '2026-09-30',
    );
  });
});
