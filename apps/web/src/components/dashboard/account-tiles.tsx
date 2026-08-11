import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';
import { type Account } from '@/lib/fixtures/portfolio';

/** Clamped at 100%: an over-contribution is a tax problem, not a wider bar. */
function usedPercent(used: Account['value'], limit: Account['value']): string {
  if (limit.isZero()) return '0';
  if (used.greaterThan(limit)) return '100';
  return used.amount.dividedBy(limit.amount).times(100).toFixed(1);
}

export function AccountTiles({
  accounts,
  locale,
  dictionary,
}: Readonly<{ accounts: readonly Account[]; locale: Locale; dictionary: Dictionary }>) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {dictionary.dashboard.accounts.title}
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <Card key={account.id} size="sm" className="gap-3 px-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {dictionary.wrappers[account.wrapper]}
                </p>
                <p className="text-muted-foreground truncate text-xs">{account.broker}</p>
              </div>
              <Badge variant="outline">{account.wrapper.toUpperCase()}</Badge>
            </div>

            <p className="text-xl font-semibold tracking-tight tabular-nums">
              {formatMoney(account.value, locale)}
            </p>

            {/* The Poland-specific bit worth having early: how much of this
                year's IKE/IKZE allowance is used up. */}
            {account.contribution !== null && (
              <div className="flex flex-col gap-1.5">
                <div className="text-muted-foreground flex items-baseline justify-between gap-2 text-xs">
                  <span>
                    {interpolate(dictionary.dashboard.accounts.limit, {
                      year: String(account.contribution.year),
                    })}
                  </span>
                  <span className="tabular-nums">
                    {interpolate(dictionary.dashboard.accounts.limitUsed, {
                      used: formatMoney(account.contribution.used, locale, { compact: true }),
                      limit: formatMoney(account.contribution.limit, locale, { compact: true }),
                    })}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuetext={`${usedPercent(account.contribution.used, account.contribution.limit)}%`}
                  className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                >
                  <div
                    className="bg-foreground/70 h-full rounded-full"
                    style={{
                      width: `${usedPercent(account.contribution.used, account.contribution.limit)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
