import { describe, expect, it } from 'vitest';
import { Temporal } from './index';

describe('Temporal', () => {
  it('constrains PlainDate arithmetic at a leap-year boundary', () => {
    const leapDay = Temporal.PlainDate.from('2024-02-29');
    expect(leapDay.add({ years: 1 }).toString()).toBe('2025-02-28');
  });

  it('handles multi-year bond anniversaries', () => {
    const issueDate = Temporal.PlainDate.from('2016-08-11');
    expect(issueDate.add({ years: 10 }).toString()).toBe('2026-08-11');
  });

  it('knows Europe/Warsaw observes DST', () => {
    const winter = Temporal.ZonedDateTime.from('2026-01-15T12:00:00[Europe/Warsaw]');
    const summer = Temporal.ZonedDateTime.from('2026-07-15T12:00:00[Europe/Warsaw]');
    expect(winter.offset).toBe('+01:00');
    expect(summer.offset).toBe('+02:00');
  });

  it('compares Instants exactly, independent of construction path', () => {
    const fromString = Temporal.Instant.from('2026-08-11T12:00:00Z');
    const fromEpoch = Temporal.Instant.fromEpochMilliseconds(fromString.epochMilliseconds);
    expect(fromString.equals(fromEpoch)).toBe(true);
  });
});
