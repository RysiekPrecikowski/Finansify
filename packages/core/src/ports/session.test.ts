import { describe, expect, it } from 'vitest';
import { userId } from './session';

describe('userId', () => {
  it('accepts a UUID', () => {
    expect(userId('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe(
      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    );
  });

  it('rejects a non-UUID string, such as a Clerk subject id', () => {
    expect(() => userId('user_2abcXYZ')).toThrow();
  });
});
