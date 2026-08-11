# UI

Web only, one codebase, and it has to be genuinely good on a phone rather than
merely survive there.

All UI lives in `apps/web` — see `architecture.md` for why there is no
`packages/ui`.

## Stack

| Concern               | Choice                                                                                                 | Why, and what else was considered                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Styling               | **Tailwind v4**, CSS-first `@theme`                                                                    | Already installed and configured                                                                                                                                                               |
| Components            | **shadcn/ui**, Vega style (the CLI's current name for what used to be called "new-york"), neutral base | Copy-in, so no runtime dependency and no upgrade treadmill. Works with Tailwind 4 and React 19. Alternatives: Park UI, Mantine — heavier and more lock-in.                                     |
| Primitives            | **Base UI**, arriving via shadcn (the `render` prop, not `asChild`)                                    | What the Vega preset installs. Radix is the same team's earlier library; the shadcn components we copy in target Base UI, so following them is cheaper than porting them.                      |
| Dashboard charts      | **Recharts** through shadcn's `<ChartContainer>`                                                       | Allocation donut and treemap, income bars, benchmark comparison. Themed by the same CSS variables as everything else. Alternatives: visx (more control, much more work), Nivo (bigger bundle). |
| Portfolio value chart | **`lightweight-charts`** (TradingView)                                                                 | ~45 kB, built for exactly this: years of bars, pan and zoom, a 15m/1h/1d granularity toggle. Recharts degrades badly past a few thousand points.                                               |
| Tables                | **TanStack Table v8** with the shadcn table                                                            | The ledger needs sorting, filtering, column visibility, and virtualization                                                                                                                     |
| Forms                 | **react-hook-form + zod**                                                                              | zod schemas are shared with `core`'s contracts — one definition, validated on both sides                                                                                                       |
| Icons                 | **lucide-react**                                                                                       | Ships with shadcn                                                                                                                                                                              |
| Dates                 | **Temporal** internally, `Intl.DateTimeFormat` at the edge                                             | ADR 0007                                                                                                                                                                                       |
| Numbers               | `Intl.NumberFormat`, currency- and locale-aware                                                        | Formatting never happens inside `core`                                                                                                                                                         |
| Theme                 | `next-themes`, **dark by default**                                                                     | Financial dashboards read better dark; light theme still supported                                                                                                                             |
| Language              | **Polish and English**, own dictionaries behind a cookie                                               | One audience, two languages, ~200 strings. `next-intl` and `/[locale]/` routing would double every route and add a dependency for a `Record<Locale, Dictionary>` and one server action.        |
| View state            | **Range, filter and sort live in the URL**                                                             | The dashboard then renders entirely on the server, every control is a real link, and a view survives a reload and a share. Client-side tab state does none of that.                            |

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

1. **Headline** — total value in the presentation currency, today's change and
   total change as both absolute and percent, and a currency switcher.
2. **Hero chart** — portfolio value over time. Range selector 1D / 1W / 1M / YTD
   / 1Y / MAX, with granularity following the range: 15-minute bars for 1D,
   hourly for 1W, daily beyond. A benchmark overlay toggle draws WIG, a world
   ETF, or the S&P 500 as a normalized second series.
3. **Allocation** — donut or treemap with a dimension switcher (asset class,
   currency, account, wrapper, geography), click to drill down.
4. **Account tiles** — one card per account with a wrapper badge, its value, and
   for IKE and IKZE **a progress bar against this year's contribution limit**.
   Poland-specific, genuinely useful, and nearly free once `wrapper_rules`
   exists.
5. **Income** — stacked monthly bars of dividends and interest with a
   year-over-year overlay.
6. **Holdings table** — instrument, quantity, average cost, price, value, P&L in
   absolute and percent terms, portfolio weight, currency. Rows expand to show
   the individual lots.

Above the headline sits a row of **asset-class filter chips**; the sort order of
the holdings list is a dropdown of links. Both, and the chart range, are URL
parameters (`?class=&range=&sort=`), so the dashboard is a server render with no
view state held anywhere else.

**What exists today** (Phase 0): the layout above, minus allocation (3) and income
(5), rendered from `src/lib/fixtures/portfolio.ts` — demo data that computes every
derived figure from a handful of declared inputs, so the headline and the rows
always agree. The hero chart is inline SVG on the server rather than
`lightweight-charts`: until the series comes from a price feed there is nothing to
pan, zoom or inspect, and a canvas library plus a hydration boundary would buy
nothing. The fixture is single-currency on purpose — there is no FX adapter before
Phase 2, and the presentation-currency switcher says so instead of converting.
Delete the fixture when the ledger lands.

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
