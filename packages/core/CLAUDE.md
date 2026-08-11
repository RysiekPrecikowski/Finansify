# packages/core

The domain. Pure TypeScript, and the only package whose contents are meant to
outlive every vendor choice around them.

Full context: `docs/architecture.md` for the boundaries, `docs/domain.md` for
what lives here.

## Purity

`core` **imports nothing from the workspace** and nothing from React, Next, a
database driver, or `fetch`. Its only runtime dependencies are `decimal.js`,
`temporal-polyfill`, and `zod`.

If a calculation needs data, it takes a **port** as a parameter. It does not go
and get it. Ports are declared in `src/ports/` and implemented in `db`,
`providers`, and `importers` — never here.

Nothing in this package performs I/O. If you are reaching for `await` around
something that is not a port call, stop and reconsider where the code belongs.

## Money and time

- Money is `Money` (a `decimal.js` `Decimal` plus a `Currency`). **No
  `parseFloat`, `parseInt`, or `Number()` in this package** — see ADR 0005.
  Arithmetic goes through `Money` methods; mixing currencies throws.
- Time is Temporal, with the type chosen deliberately: `PlainDate` for trade and
  settle dates, `ZonedDateTime` for market sessions, `Instant` for price bars.
  See ADR 0007.
- **Neither is ever formatted here.** `Intl.NumberFormat` and
  `Intl.DateTimeFormat` belong at the UI edge. A function in `core` that returns
  a display string is in the wrong place.

## Layout

`src/<domain>/` where domain is one of `money`, `time`, `ledger`, `positions`,
`valuation`, `performance`, `income`, `allocation`, `instruments`, `bonds`,
`wrappers`, `ports`, `usecases`.

Each folder has an `index.ts`, and cross-domain imports go through those barrels
only. Intra-package imports are **extensionless** — Turbopack cannot resolve a
`.js` specifier to a `.ts` file.

## Use cases

Factory functions closing over their dependencies, not classes and not a DI
container:

```ts
export function makeValuePortfolio(deps: { ledger: LedgerRepository /* ... */ }) {
  return async function valuePortfolio(input): Promise<PortfolioValuation> {
    /* ... */
  };
}
```

## Tests

Colocated `*.test.ts`, run by the root Vitest config. Tests use **in-memory fakes
of the ports** — never a database and never the network. If a test in this
package needs either, the code under test has a dependency it should not have.

The bond accrual engine is held to a higher standard than the rest: golden tests
against the official published interest tables, matching to the grosz. See
ADR 0011.
