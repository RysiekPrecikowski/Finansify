import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { type DashboardAccount } from '@/lib/dashboard/snapshot';
import { formatMoney } from '@/lib/format';
import { type Dictionary } from '@/lib/i18n/dictionaries';
import { type Locale } from '@/lib/i18n/locales';

export function AccountTiles({
  accounts,
  locale,
  dictionary,
}: Readonly<{ accounts: readonly DashboardAccount[]; locale: Locale; dictionary: Dictionary }>) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {dictionary.dashboard.accounts.title}
      </h2>

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
          </Card>
        ))}
      </div>
    </section>
  );
}
