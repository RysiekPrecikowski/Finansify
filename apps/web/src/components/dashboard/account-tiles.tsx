import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { type AccountContribution, type DashboardAccount } from '@/lib/dashboard/snapshot';
import { formatMoney } from '@/lib/format';
import { interpolate, plural, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/** Past this share of the limit, the bar switches to `--brand` — close enough that the next contribution needs checking. */
const warnAbove = 0.92;

/**
 * The IKE/IKZE contribution-limit row: `LIMIT 2026`, `{used} / {limit}`, and a
 * thin bar.
 *
 * Both figures are compact (`5,2 / 28,3 tys. zł`) and on one line — a tile is
 * three columns wide on a phone at worst and the row must not wrap into the
 * value above it. The limit is a real published figure; `used` is an
 * approximation, which is what the `title` says (see `AccountContribution`).
 */
function ContributionBar({
  contribution,
  locale,
  dictionary,
}: Readonly<{ contribution: AccountContribution; locale: Locale; dictionary: Dictionary }>) {
  const strings = dictionary.dashboard.accounts;
  const year = String(contribution.year);
  const ratio = Number(contribution.ratio);
  // Clamped for the bar only: the figures beside it still read past the limit
  // if that is where they are, but a fill wider than its track is a rendering
  // bug, not a statement.
  const filled = Math.min(Math.max(ratio, 0), 1);

  return (
    <div className="flex flex-col gap-1.5" title={interpolate(strings.limitApproximate, { year })}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-[0.6875rem] font-medium tracking-wide whitespace-nowrap uppercase">
          {interpolate(strings.limit, { year })}
        </span>
        <span className="text-muted-foreground text-[0.6875rem] whitespace-nowrap tabular-nums">
          {formatMoney(contribution.used, locale, { compact: true, bare: true })}
          {' / '}
          {formatMoney(contribution.limit, locale, { compact: true })}
        </span>
      </div>

      <div
        className="bg-muted h-1 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(filled * 100)}
        aria-label={interpolate(strings.limit, { year })}
      >
        {/* Neutral by default; `--brand` near the ceiling. Never green or red —
            those are profit and loss, and a full IKE is neither (docs/ui.md). */}
        <div
          className={cn(
            'h-full rounded-full',
            ratio >= warnAbove ? 'bg-brand' : 'bg-foreground/70',
          )}
          style={{ width: `${(filled * 100).toFixed(2)}%` }}
        />
      </div>
    </div>
  );
}

export function AccountTiles({
  accounts,
  locale,
  dictionary,
}: Readonly<{ accounts: readonly DashboardAccount[]; locale: Locale; dictionary: Dictionary }>) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {dictionary.dashboard.accounts.title}
        </h2>
        {/* "3 rachunki", "5 rachunków" — Polish has three plural forms and
            `plural()` picks between them through `Intl.PluralRules`. */}
        <span className="text-muted-foreground/70 text-[0.6875rem] tabular-nums">
          {plural(dictionary.dashboard.accounts.count, accounts.length, locale)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <Card key={account.id} size="sm" className="gap-3 rounded-2xl px-4 shadow-none ring-0">
            {/* Flat surface layering (docs/ui.md dashboard redesign): the
                shared `<Card>` ships a border/shadow for the rest of the app,
                overridden here to sit as a plain raised block on the
                dashboard's `surface-1`/`surface-2` background instead. */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {dictionary.wrappers[account.wrapper]}
                </p>
                <p className="text-muted-foreground truncate text-xs">{account.broker}</p>
              </div>
              <Badge variant="outline">{account.wrapper.toUpperCase()}</Badge>
            </div>

            {/* `null` means a price or an exchange rate was missing for
                something held here — a dash rather than a partial number
                passed off as the whole (rule 7). */}
            {account.value === null ? (
              <p className="text-muted-foreground text-xl font-semibold tracking-tight">—</p>
            ) : (
              <p className="text-xl font-semibold tracking-tight tabular-nums">
                {formatMoney(account.value, locale)}
              </p>
            )}

            {account.contribution !== null && (
              <ContributionBar
                contribution={account.contribution}
                locale={locale}
                dictionary={dictionary}
              />
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
