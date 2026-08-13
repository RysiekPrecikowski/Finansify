# Architecture

Ports and adapters, with a single composition root in the Next.js app. The point
is that every replaceable thing — database, auth, market-data provider — sits
behind an interface owned by the domain, so replacing it never touches a
calculation.

Decisions behind this: ADR 0001 (the shape), ADR 0002 (why it is not lint-enforced),
ADR 0003 (why nothing is precomputed).

## Packages

```
apps/web                  Next.js 16 App Router. Composition root: the ONLY
                          place that imports adapters and wires them into core
                          use cases. Also owns all UI.

packages/core             Domain. Pure TypeScript. Value objects, entities,
                          calculation engines, use cases, and PORT INTERFACES.
                          Dependencies: decimal.js, temporal-polyfill, zod.
                          Nothing else. No React, no Next, no SQL, no fetch.

packages/db               Adapter. Drizzle schema, migrations, and repository
                          implementations of core's persistence ports.

packages/providers        Outbound adapters. Market prices, FX, macro indices,
                          bond reference data. Implements core's feed ports.

packages/importers        Inbound adapters. Broker statement parsers
                          implementing core's StatementParser port.
```

Four packages, one app.

**UI stays inside `apps/web`.** A `packages/ui` is not justified with a single
consumer, and shadcn/ui's copy-in model fights monorepo extraction — registry
aliases and Tailwind content paths both have to be fought. Extract it when a
second app exists, not before.

## The dependency rule

```
                    apps/web
                   /    |    \
                  /     |     \
         packages/db  providers  importers
                  \     |     /
                   \    |    /
                    packages/core
                          |
                     (nothing)
```

- `core` imports nothing from the workspace. It **defines** interfaces; it never
  imports an implementation.
- `db`, `providers`, and `importers` import `core` only to implement its ports
  and use its value objects. **They never import each other.**
- `apps/web` is the only package that may import all of them, and only from its
  server layer.

Enforced by review, not by tooling. That is a deliberate trade — see ADR 0002 —
and it is why `CLAUDE.md` exists and why it has to stay short enough to be read.

## Ports

Ports live in `packages/core/src/ports/`. Illustrative, not exhaustive:

```ts
// Outbound: data we read from the world
export interface PriceFeed {
  latest(ids: InstrumentRef[]): Promise<Map<InstrumentRef, PricePoint>>;
  history(id: InstrumentRef, range: DateRange, g: Granularity): Promise<PricePoint[]>;
}
export interface FxRateFeed {
  rate(base: Currency, quote: Currency, on: Temporal.PlainDate): Promise<Decimal>;
}
export interface IndexRateFeed {
  series(index: IndexId, range: DateRange): Promise<IndexObservation[]>;
}
export interface BondTermsResolver {
  resolve(series: BondSeriesCode): Promise<BondTerms | null>;
}

// Outbound: persistence
export interface LedgerRepository {
  forUser(userId: UserId): ScopedLedgerRepository;
}
export interface PriceCache {
  read(...): Promise<...>;
  write(...): Promise<void>;
}
export interface FileStore {
  put(key: string, body: Blob): Promise<StoredFile>;
}

// Inbound
export interface StatementParser {
  readonly broker: BrokerId;
  sniff(file: RawFile): Promise<Confidence>;
  parse(file: RawFile): Promise<ParsedStatement>;
}

// Ambient
export interface Clock {
  now(): Temporal.Instant;
}
export interface SessionProvider {
  current(): Promise<AuthenticatedUser | null>;
}
```

Note the shape of `LedgerRepository`: you cannot obtain a query interface without
naming a user. See ADR 0009.

## Use cases: functional core, imperative shell

No DI container, no decorators, no `reflect-metadata`. Use cases are factory
functions closing over their dependencies:

```ts
// packages/core/src/usecases/value-portfolio.ts
export function makeValuePortfolio(deps: {
  ledger: LedgerRepository;
  prices: PriceFeed;
  fx: FxRateFeed;
  bonds: BondTermsResolver;
  clock: Clock;
}) {
  return async function valuePortfolio(input: {
    scope: PortfolioScope;
    asOf: Temporal.PlainDate;
    presentIn: Currency;
  }): Promise<PortfolioValuation> {
    /* pure orchestration over pure engines */
  };
}
```

`apps/web/src/server/container.ts` instantiates the adapters once and exports
them — `getDb()`, `getInstruments()`, `scopedLedgerFor(userId)`. A route composes
the use case it needs from those ports:

```ts
const recordTransaction = makeRecordTransaction({ ledger: scopedLedgerFor(user.id) });
```

The container stops at the ports rather than exporting ready-made use cases
because every user-scoped port needs the _request's_ user: a ready-made export
would still have to take a `userId` (rule 4, ADR 0009), and composing at the
call site keeps a route's real dependencies visible in the route.

Either way the property that matters holds: swapping Neon for Turso, or Yahoo
for Stooq, is an edit in one file plus one package — never a change to a
calculation.

Testing follows for free: `core` is tested against in-memory fakes of the ports.
No database, no network, fast enough to run on every save.

## Layout conventions

- `packages/core/src/<domain>/` where domain is one of `money`, `time`, `ledger`,
  `positions`, `valuation`, `performance`, `income`, `allocation`, `instruments`,
  `bonds`, `wrappers`, `ports`, `usecases`. Each folder has an `index.ts`;
  cross-domain imports go through those barrels only.
- `apps/web/src/app/(app)/<feature>/` route groups mirror the core domains.
- Intra-package imports are **extensionless**. Turbopack cannot resolve a `.js`
  specifier to a `.ts` file, and `verbatimModuleSyntax` with
  `moduleResolution: Bundler` is already set in `tsconfig.base.json`.

Adding a feature, ask in order: does it need a new port? a new adapter? a new
table and migration? a new route? If it moves a boundary, it needs an ADR.

## Caching

Three layers, no cron. The refresh cadences the product promises — 15 minutes,
hourly, daily — are cache TTLs and chart granularities, not scheduled jobs.

**L1 — the shared market-data cache** (`prices`, `fx_rates`,
`index_observations`, `bond_series_terms`). Global, unscoped, shared by every
user. See `data-sources.md` for the per-source TTLs.

**L2 — Next.js Cache Components** (`use cache`, `cacheLife`, `cacheTag`).
Derived read models are cached per user and tagged `user:{id}` and
`portfolio:{id}`. Any ledger mutation calls `updateTag(...)`, and the dashboard
is correct on the next read.

> **Footgun.** Valuations are private per-user data. Every `use cache` boundary
> over a valuation must take the user id as an argument so it participates in the
> cache key. Only the price and FX layer is genuinely shared. Getting this wrong
> leaks one user's portfolio to another — it belongs on every review checklist.
> See ADR 0010.

**L3 — request-scoped memoization** via React `cache()`, so one render does not
value the same portfolio five times across five components.

### Freshness without a scheduler

On request, if a cached price is past its TTL and the market is open: serve the
stale value immediately, then refresh in the background with `after()` from
`next/server`. Vercel runs post-response work on Fluid Compute, so users perceive
fifteen-minute freshness with no scheduled jobs at all.

A per-instrument fetch guard — a Postgres advisory lock or a `refreshing_until`
column — prevents a thundering herd when several dashboards load at once.

### Market calendar

Knowing whether an exchange is open is required to avoid refetching all weekend
and to avoid labelling Friday's close as live. A small table of exchange →
timezone, session hours, and holidays, with Temporal doing the timezone maths.
Boring, small, and the thing naive trackers get wrong.

### Retention

`m15` bars for 30 days, `h1` for one year, `d1` forever. This bounds storage
growth, and it is the lever that keeps the database question in ADR 0008 from
being urgent.
