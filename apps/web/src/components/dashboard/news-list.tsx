import { sortHoldings, type DashboardHolding } from '@/lib/dashboard/snapshot';
import { interpolate, type Dictionary } from '@/lib/i18n/dictionaries';

/**
 * Placeholder only, by explicit product decision: static, clearly-fake
 * headlines shaped like the real thing (symbol, relative time, short line),
 * scoped to the reader's own top holdings so it at least *reads* as filtered
 * to their positions. No real news integration — see the redesign ticket.
 */
const templateKeys = ['results', 'upgrade', 'target', 'launch', 'regulatory'] as const;
const timeSlots: readonly { readonly key: 'hoursAgo' | 'daysAgo'; readonly amount: number }[] = [
  { key: 'hoursAgo', amount: 2 },
  { key: 'hoursAgo', amount: 5 },
  { key: 'daysAgo', amount: 1 },
  { key: 'daysAgo', amount: 2 },
  { key: 'hoursAgo', amount: 9 },
];

export function NewsList({
  holdings,
  dictionary,
}: Readonly<{ holdings: readonly DashboardHolding[]; dictionary: Dictionary }>) {
  const strings = dictionary.dashboard.news;
  const featured = sortHoldings(
    holdings.filter((holding) => holding.valuation !== null),
    'valueDesc',
  ).slice(0, 4);

  if (featured.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {strings.title}
      </h2>

      <ul className="flex flex-col gap-1">
        {featured.map((holding, index) => {
          const templateKey = templateKeys[index % templateKeys.length]!;
          const slot = timeSlots[index % timeSlots.length]!;
          const headline = interpolate(strings.templates[templateKey], { symbol: holding.symbol });
          const time =
            slot.key === 'hoursAgo'
              ? interpolate(strings.times.hoursAgo, { hours: String(slot.amount) })
              : interpolate(strings.times.daysAgo, { days: String(slot.amount) });

          return (
            <li key={holding.id} className="flex items-baseline gap-3 py-2">
              <span className="text-muted-foreground w-16 shrink-0 text-xs tabular-nums">
                {time}
              </span>
              <span className="flex-1 text-sm">{headline}</span>
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground/70 text-xs">{strings.disclaimer}</p>
    </section>
  );
}
