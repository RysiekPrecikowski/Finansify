# UI

Web only, one codebase, and it has to be genuinely good on a phone rather than
merely survive there.

All UI lives in `apps/web` — see `architecture.md` for why there is no
`packages/ui`.

## Stack

| Concern               | Choice                                                                                                 | Why, and what else was considered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Styling               | **Tailwind v4**, CSS-first `@theme`                                                                    | Already installed and configured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Components            | **shadcn/ui**, Vega style (the CLI's current name for what used to be called "new-york"), neutral base | Copy-in, so no runtime dependency and no upgrade treadmill. Works with Tailwind 4 and React 19. Alternatives: Park UI, Mantine — heavier and more lock-in.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Primitives            | **Base UI**, arriving via shadcn (the `render` prop, not `asChild`)                                    | What the Vega preset installs. Radix is the same team's earlier library; the shadcn components we copy in target Base UI, so following them is cheaper than porting them.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dashboard charts      | **Recharts** through shadcn's `<ChartContainer>`                                                       | Allocation donut and treemap, income bars, benchmark comparison. Themed by the same CSS variables as everything else. Alternatives: visx (more control, much more work), Nivo (bigger bundle).                                                                                                                                                                                                                                                                                                                                                                                  |
| Portfolio value chart | **Inline SVG**, deferred to `lightweight-charts`                                                       | CU-869ej7zk8 (ADR 0020) shipped the real series on the same inline-SVG chart Phase 0 sketched, with LTTB downsampling (`lib/chart-series.ts`) rather than adopting `lightweight-charts` — the tween, the partial/complete split and the mobile layout all already worked, and pan/zoom/a granularity toggle earn their ~45 kB once intraday data (CU-869em7hdp) makes deep, fine-grained history worth panning through. Recharts degrades badly past a few thousand points, which is why neither this nor the eventual `lightweight-charts` move go through `<ChartContainer>`. |
| Tables                | **TanStack Table v8** with the shadcn table                                                            | The ledger needs sorting, filtering, column visibility, and virtualization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Forms                 | **Server Actions + `useActionState`**, zod schemas from `core`                                         | The authoritative validation is `transactionInputSchemaFor(account.currency)`, which needs the account and so runs on the server regardless; a client mirror would be a second copy of the same rule. Progressive enhancement for free, no dependency. react-hook-form comes back for a form that genuinely needs field arrays or cross-field client validation.                                                                                                                                                                                                                |
| Icons                 | **lucide-react**                                                                                       | Ships with shadcn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Dates                 | **Temporal** internally, `Intl.DateTimeFormat` at the edge                                             | ADR 0007                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Numbers               | `Intl.NumberFormat`, currency- and locale-aware                                                        | Formatting never happens inside `core`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Theme                 | `next-themes`, **dark by default**                                                                     | Financial dashboards read better dark; light theme still supported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Language              | **Polish and English**, own dictionaries behind a cookie                                               | One audience, two languages, ~200 strings. `next-intl` and `/[locale]/` routing would double every route and add a dependency for a `Record<Locale, Dictionary>` and one server action.                                                                                                                                                                                                                                                                                                                                                                                         |
| View state            | **Range, filter and sort live in the URL**                                                             | Every control is a real link, and a view survives a reload and a share. Client-side tab state does none of that. Chart range also switches without a navigation — see "The hero chart" below.                                                                                                                                                                                                                                                                                                                                                                                   |

## Visual direction

Dark, dense, calm. A neutral slate surface with a single accent colour, and
**green and red reserved exclusively for profit and loss** — never for buttons,
badges, links, or chrome.

That one rule carries most of the legibility. When the only coloured things on
screen are gains and losses, the eye finds them instantly; when everything is
coloured, nothing is.

Supporting habits: tabular figures for anything numeric, right-aligned; generous
use of muted foreground for labels so values dominate; borders over shadows.

## Localisation

Polish and English, both first-class. The locale lives in a `finansify_locale`
cookie, defaults to `pl`, and is read once per request in the root layout:

- `src/lib/i18n/dictionaries/pl.ts` is the **source dictionary** — `Dictionary`
  is its type, so `en.ts` cannot drift or lose a key without failing typecheck.
- Server components take strings from `getDictionary()`; client components take
  them from `useI18n()`, provided from the same cookie-derived value so both
  sides render the same language.
- Switching writes the cookie in a server action and lets the re-render carry the
  whole page over. There is no client-side dictionary swap and no flash.
- `Locale` is the UI language; `intlLocale` maps it to the BCP 47 tag handed to
  `Intl`. They are not the same thing and are deliberately separate values.

Money keeps its own currency regardless of language — an English UI still shows
`zł`, because the currency is data and the language is a preference.

One formatting decision worth knowing: `formatMoney` passes `useGrouping:
'always'`, because `pl-PL` otherwise starts grouping at five digits and
`5796,00 zł` ends up in a column next to `38 682,00 zł`.

## The dashboard

Top to bottom:

1. **Headline** — total value in the presentation currency, a "data as of"
   timestamp, the total change as absolute and percent, and a summary strip of
   total change beside cost basis ("Zainwestowane"). The scope note — open
   positions only, NBP mid, cash not yet counted — is an info icon beside the
   value rather than a sentence in the flow; it is a caveat about what the
   figure covers, not a warning about the figure, which is why the
   `totalValueIncomplete` line still renders inline.
2. **Hero chart** — portfolio value over time, under its own header row (title
   left, benchmark selector right). Range selector 1D / 1W / 1M / YTD / 1Y /
   MAX, with granularity following the range: 15-minute bars for 1D, hourly for
   1W, daily beyond. A benchmark selector draws WIG20TR, MSCI World, or the
   S&P 500 as a normalized second series — dashed, in `--brand`, with a legend
   under the chart — and three tiles below the range tabs give portfolio,
   benchmark and the difference for the selected window.

   **Both the benchmark series and the "TWR" tile are approximations today**,
   and say so in their own tooltips. No provider fetches an index level, so
   `lib/dashboard/benchmarks.ts` generates a deterministic, seeded path
   normalized to the portfolio's own first value — the same
   honestly-labelled-placeholder stance `lib/dashboard/demo-enrichment.ts` and
   `news-list.tsx` already take. The portfolio tile is a plain period return
   over the value series, so deposits and withdrawals inflate it; real
   deposit-neutralized TWR is Phase 5. Replacing `buildBenchmarkSeries` with a
   real series is the whole of the first fix.

3. **Allocation** — donut or treemap with a dimension switcher (asset class,
   currency, account, wrapper, geography), click to drill down.
4. **Account tiles** — one card per account with a wrapper badge, its value, an
   account count beside the section heading, and for IKE and IKZE **a progress
   bar against this year's contribution limit**. Poland-specific and genuinely
   useful. The limit is real — `publishedWrapperRules` in `packages/core`, each
   row carrying its KNF citation — and a year with no published row drops the
   bar rather than extrapolating one. **What is contributed is not**: nothing in
   the ledger separates a contribution from growth inside the wrapper, so the
   bar stands the account's current PLN value in for it and labels that as an
   approximation. Replace `AccountContribution.used` — and only `used` — once
   `wrapper_rules` tracks contributions.
5. **Income** — stacked monthly bars of dividends and interest with a
   year-over-year overlay.
6. **Holdings table** — instrument, quantity, average cost, price, value, P&L in
   absolute and percent terms, portfolio weight, currency. A row links to the
   same per-instrument lot detail as the portfolio screen below — no in-place
   expansion; `<DataList>` is a server component with no expansion state to
   hook into. Reconsidered if there is ever a reason a lot needs to be visible
   without a navigation.

Above the headline sits a row of **asset-class filter chips**; the sort order of
the holdings list is a dropdown of links. Both, and the chart range and
benchmark, are URL parameters (`?class=&range=&sort=&bench=`), and `class` and
`sort` are server renders with no view state held anywhere else. `range` and
`bench` switch on the client and write the URL back with `replaceState` — both
are derived from data the browser already holds, so a round trip would fetch
nothing.

The app bar is **one row**: the sidebar trigger, a two-line identity block
(portfolio name over screen name, from `components/header-title.tsx`), then
theme, language and the presentation currency as a filled pill. The wordmark
lives in the sidebar and the mobile drawer only, and pages under `(app)` do not
render their own `<h1>` for a title the bar already carries.

### The hero chart

Draws `portfolioValueSeries` (CU-869ej7zk8, ADR 0020) — the ledger folded
day-by-day against the global price/FX cache, derived on read, never stored.
Still inline SVG, not `lightweight-charts`: see the stack table above for why
that move stays deferred.

**The server renders the current range immediately from storage** —
`readValueSeries` touches no network, so the chart paints on the same request
as the rest of the dashboard. `ChartCard` (client) then polls
`GET /api/portfolio/value-series?range=…&refresh=1` in bounded rounds
(`MAX_REFRESH_ROUNDS = 6`) whenever the response comes back `pending`, and the
dashed prefix (below) visibly shrinks as each round's backfill lands — that
progressive fill, not a spinner, is the "as fast as possible" requirement
CU-869ej7zk8 was scoped around.

**Range switches on the client, without a round trip, once cached** — kept
exactly as Phase 0 designed it, the one piece of view state that lives outside
the URL-driven server render `class` and `sort` still use. The URL stays the
single source of truth regardless: the range is read from it on the client
too, and each switch writes it straight back with `history.replaceState`, so
reload and share behave exactly as a plain navigation would. The tabs stay
real links: cmd-click still opens a new tab, and with JavaScript off they
navigate. A range not yet cached client-side (anything but the one the server
rendered) fetches once, storage-only, then starts the same `refresh=1` polling
above. `1D`/`1W` are the one exception to "real link" — rendered as inert
`<span>`s, because the price cache holds no bar finer than a day
(`unsupportedRanges`, `lib/dashboard-params.ts`; CU-869em7hdp tracks unlocking
them).

That guarantee rests on one rule, and breaks quietly without it: **every
dashboard control builds its href from the live params** (`useDashboardParams`),
never from one the server passed down. A href rendered before a client-side
switch still carries the old range, so clicking a chip would drop the range the
user just picked and the next reload would show a different chart than the
screen did.

The switch is animated — the line interpolates into its new shape over 350 ms
and the y-axis travels with it, rather than the reader being handed a different
chart between blinks. **`prefers-reduced-motion: reduce` snaps instead**, which
is not optional: a chart that redraws itself is exactly the motion that setting
exists to turn off. A `refresh=1` poll landing new points for the _same_ range
snaps rather than tweens — nothing to animate between two readings of one
range, same as a chip or sort re-render always did.

**A missing price is drawn, not hidden.** A point the backfill hasn't reached
yet renders `partial`: the line segment up to the first `complete` point is
dashed, at reduced opacity (`ValueChart`'s `partialBoundary`) — proportional to
how much of the _source_ series is still partial, since LTTB's bucket
selection doesn't preserve a 1:1 index mapping to draw an exact boundary from.
This is rule 7 applied to a series instead of a single value: never
interpolated, never hidden, always shown as what it is.

Two consequences worth knowing:

- Every series is resampled to one fixed width (`lib/chart-series.ts`,
  `chartPointCount = 64`) so the tween can pair point _i_ with point _i_ and so
  a `MAX` window's few hundred points don't get sent to the SVG's `d` attribute
  wholesale. Upsampling (a young portfolio, fewer source points than the
  target) stays linear, exact at both endpoints; downsampling uses LTTB
  (largest-triangle-three-buckets), which keeps a real spike visible instead of
  averaging it away — the failure mode a naive linear downsample has once
  `MAX`/`1Y` routinely carry more points than the chart draws.
- `lightweight-charts` **does not animate a series swap** either, when that
  move eventually happens. It is built for pan and zoom over many bars. The
  tween — and the partial/complete split above — are the parts that will need
  re-solving inside the canvas, not something the library hands over.
- Money never crosses to the client as a `Money`/`Decimal` — the API route
  (and the server's own first paint) serialize each point's value as a plain
  decimal string, and `lib/hero-series.ts` parses it to a `number` for pixel
  geometry only, the same "display geometry, not a number anyone reads
  directly" stance `chart-series.ts` already took. `@finansify/core` never
  reaches the client bundle this way (`apps/web/AGENTS.md`).

## The transactions screen

Three routes, all server components reading through `scopedLedgerFor(user.id)`:

| Route                     | Does                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `/transactions`           | The ledger through `<DataList>`, newest first                 |
| `/transactions/new`       | Create; redirects to `/accounts/new` when there is no account |
| `/transactions/[id]/edit` | Edit, plus soft delete as a `<form>` submit                   |

The form is one client component shared by create and edit. A single
`useState` on the transaction type drives everything conditional, resolved
against `transactionShapeOf` — computed on the server and passed down as plain
data, so `core` (and with it Decimal, zod and Temporal) stays out of the browser
bundle. `vocabulary.ts` is the only part of `core` the form imports directly,
which is what that module is for.

Three rules the screen exists to respect:

- **Amounts are `type="text" inputMode="decimal"`, never `type="number"`.** A
  number input silently discards what the browser considers invalid and invites
  `valueAsNumber`. `lib/decimal-input.ts` turns `1 234,56` into `1234.56` as a
  string rewrite that never parses; anything it cannot normalise passes through
  untouched and is refused by the schema, which is where the message belongs.
- **A foreign-currency row reveals `fxRate` and `fxRateSource`, and the server
  refuses it without them** (rule 6, ADR 0006). The client only explains; the
  refusal is `transactionInputSchemaFor(account.currency)`.
- **`split` is not offered.** `buildPositions` throws on it by design, so
  offering it would let someone write a row that breaks their own positions view.

Nothing on this screen is green or red — a transaction is neither a gain nor a
loss.

## The portfolio screen

`/portfolio` and `/portfolio/[instrumentId]`, both server components built on
`makeListPositions({ ledger, instruments })` (`packages/core/src/usecases/list-positions.ts`)
— the read model that folds `buildPositions`/`buildCashBalances` and joins in
the `Instrument` and `Account` rows, so the page itself does no aggregation.

Top to bottom: the portfolio total with its two caveats, an "add transaction"
pill, the two filter rows, then open positions, closed positions and cash.

- **Total** — market value in the presentation currency, with the scope note
  (open positions only, NBP mid, cash not counted) and, when a position could
  not be priced or converted, `totalValueIncomplete`. The second one is not
  decoration: without it a partial sum reads as the whole figure (rule 7).
- **Open positions** — one row per instrument, summing quantity and cost basis
  across every account that holds it. Realized P&L is green or red; cost basis
  never is, because it is not a gain or a loss.
- **Closed positions** — an instrument whose summed quantity across accounts has
  returned to exactly zero, with only its realized P&L still worth showing.
- **Cash** — per `(account, currency)`, exactly what `buildCashBalances`
  produces, with a note explaining why there is no combined total yet. One
  account holding two currencies is two rows, never one summed at an invented
  rate.

**Two filters, both URL parameters** (`?class=`, `?wrapper=`), server-rendered
the way the dashboard's already are — no client-only filter state. They reuse
structure the ledger already has rather than introducing a "custom portfolio"
concept: `class` is the instrument's own kind, `wrapper` is the tax wrapper of
the account a position sits in, which is the axis this product is actually
about (`docs/product.md`). A dimension with only one value held renders no
chips at all — a filter whose every option is the same option is noise. The
chip look is `components/filter-chips.tsx`, shared with the dashboard so the
two screens cannot drift.

**The total is not filtered.** A filter narrows the list you are reading; it
does not redefine what you own, and a headline that moved with every chip would
disagree with the dashboard's for no stated reason.

**A retail bond is a different row, not a styled variant.** Nothing quotes it
(ADR 0011) — it is subscribed from and redeemed by the Ministry, and its value
comes from the accrual engine running against published interest tables. So a
`bond` row never shows a price, a stale-quote timestamp, or "not mapped to a
provider": all three describe a market feed that will never exist for it, and
the last reads as a defect rather than as the instrument working normally. It
carries `portfolio.accrualNote` in that slot instead. `catalyst_bond` is
deliberately excluded from that branch — it trades on GPW and is priced exactly
like an equity (ADR 0023).

On a phone the open-position rows render as the canvas's position card
(identity and value, a three-up cost row, a hairline footer with accounts and
the way into the lots) through `<DataList mobileCard>`; the desktop `<table>`
still comes from the same column definitions. That prop exists so this screen
did not need a second responsive-table implementation beside `<DataList>`.

**Cross-currency is refused, not converted.** When the same instrument is held
in accounts of different currencies, quantity still sums (same units), but cost
basis and realized P&L render one `Money` per currency rather than a blended
figure — inventing an exchange rate here is exactly what rule 6/7 forbid before
Phase 2's FX feed exists. `averageCost` is `null` whenever more than one
currency contributes, and the row shows a "multiple currencies" badge instead
of a number that would otherwise look precise and be wrong.

A row links to `/portfolio/[instrumentId]`, which re-runs the same read model
and renders the position's open lots per account (opened date, original and
remaining quantity, original and remaining cost) — the FIFO/LIFO/average/
specific-lot detail `matchLots` actually produces, and the most interesting
part of Phase 1 to have invisible.

## Mobile

Reference devices: iPhone 13 mini (375 px, the narrowest realistic target) and
a mid-size Android like the Pixel (~412 px). Every layout is checked at both
widths, not just resized down from desktop.

- **Bottom tab bar on mobile, left sidebar on desktop** — Dashboard, Portfolio,
  Transactions, More. Same routes, one layout component.
- **A `<DataList>` primitive** that renders a real `<table>` at `md` and above
  and stacked cards below. Written once, used by every table in the app. This is
  the piece worth building early — retrofitting responsive tables is miserable.
  Built: `src/components/data-list.tsx`. A column declares which phone slot it
  occupies (`title`, `subtitle`, `value`, `meta`) and columns without one simply
  do not appear at 375 px — the caller picks the four values that matter rather
  than letting the browser squeeze nine columns.
- **Charts are touch-first**: tap to inspect, no hover-only affordances, larger
  hit targets.
- **Large numbers abbreviate on narrow screens** — `1,2 mln zł`.
- **A PWA manifest** so it installs to the home screen. Cheap, and it is what
  makes a web app feel like an app.

## Rendering and performance

Server Components render the shell and cached values; live price refreshes stream
in. Each dashboard card sits behind its own `<Suspense>` boundary, so one slow
provider degrades a single card rather than blanking the page. Next 16's Cache
Components give a static shell with dynamic holes.

Two things the UI must always express, because the domain guarantees them:

- **Stale data is labelled**, with the timestamp of the value shown. Never render
  an old number as though it were live.
- **An unvaluable position is visible as such**, not quietly dropped from the
  total. See `data-sources.md`.
