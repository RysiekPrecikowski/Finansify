# packages/importers

Inbound adapters: broker statement parsers implementing `core`'s
`StatementParser` port. See `docs/architecture.md` for the boundary and ADR
0015 for what this port does and deliberately does not do.

## Rules

- Imports `@finansify/core` only, to implement `StatementParser` and use its
  value objects; never imports `@finansify/db`, `@finansify/providers`, or
  `apps/web` (adapters don't import each other —
  `docs/architecture.md`).
- One module per broker (`src/xtb/`). Nothing in `src/xtb/` may be imported
  from another broker's module or vice versa — the same isolation
  `packages/providers` holds between `src/yahoo/` and `src/nbp/`.
- A parser never resolves an instrument, matches an account, or dedups
  against existing transactions — `ParsedRow.instrument` stays an unresolved
  `ParsedInstrumentCandidate`, and `parse()` never touches
  `InstrumentRepository` or `LedgerRepository` (ADR 0015). If a parser file
  starts wanting either, that is a sign the logic belongs in the import use
  case instead, not a reason to import them here.
- `numeric` values become `Decimal`/`Money` at the edge of this package —
  never `Number()`, never `parseFloat` on anything that ends up in a
  `ParsedRow`'s money or quantity fields (rule 1). `exceljs` hands back
  numeric cells as JS `number`s; `new Decimal(cell)` is safe as-is —
  decimal.js parses a finite number through its own shortest round-tripping
  string, the same value `.toString()` would give, so there is no separate
  "convert via string first" step to remember. What actually loses precision
  is doing `+`/`-`/`*`/`/` on the raw `number` _before_ it becomes a
  `Decimal` — a cell value is wrapped in `Decimal`/`Money` immediately on
  read, and every computation after that (the FX-ratio inference, gross vs.
  quantity×price checks) goes through `Decimal`/`Money` methods, never
  native arithmetic on a `number`.
- A statement a parser cannot fully explain is not a bug to route around.
  `ParsedRow.warnings` exists precisely so "the export doesn't say enough"
  reaches the review screen as a visible fact — `parse()` never throws on a
  reconciliation mismatch and never drops a row because of one.
- Fixtures are synthetic, built from scratch, and committed. Real personal
  export files are gitignored under `__private/` and never copied into a
  fixture, even partially — see `src/xtb/fixture/generate.ts`.
