import { type Temporal } from '../time';

/**
 * Ambient port: what time it is. `core` never calls `Temporal.Now` directly —
 * a use case that reads the clock itself cannot be tested for TTL behaviour
 * without actually waiting, so freshness logic (`readPrices`, `refreshPrices`)
 * takes this instead. Mirrors `SessionProvider`'s shape and rationale.
 */
export interface Clock {
  now(): Temporal.Instant;
}
