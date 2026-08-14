import { afterEach, describe, expect, it, vi } from 'vitest';

import { callYahoo } from './client';

/**
 * `yahoo-finance2` reports a rate limit as `HTTPError(responseText ||
 * statusText)` with the status on `error.code`. These pin that shape: a 429
 * whose message never mentions the number still has to be retried, and a
 * non-429 still has to propagate on the first attempt.
 */
function httpError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code, name: 'HTTPError' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('callYahoo', () => {
  it('retries a 429 carried on error.code, whose message never mentions it', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError('Rate limited by upstream', 429))
      .mockResolvedValueOnce('ok');

    const promise = callYahoo(fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts and rethrows the rate-limit error', async () => {
    vi.useFakeTimers();
    const error = httpError('Rate limited by upstream', 429);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    const promise = callYahoo(fn);
    const assertion = expect(promise).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does not retry a non-rate-limit failure', async () => {
    vi.useFakeTimers();
    const error = httpError('Not Found', 404);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    const promise = callYahoo(fn);
    const assertion = expect(promise).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
