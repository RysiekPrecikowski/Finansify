import { calculateNetWorth } from '@finansify/core';

/**
 * Placeholder shell. Phase 1 replaces this with the real portfolio list.
 * Kept deliberately thin so it is obvious this is scaffolding, not a feature.
 */
export default function HomePage() {
  const netWorth = calculateNetWorth('0', '0');

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-muted-foreground text-sm">Finansify</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Ledger-first portfolio tracking
        </h1>
      </div>

      <div className="border-border rounded-lg border p-6">
        <p className="text-muted-foreground text-sm">Net worth</p>
        <p className="tabular mt-1 text-2xl font-medium">{netWorth.toFixed(2)} PLN</p>
        <p className="text-muted-foreground mt-4 text-sm">
          No accounts yet. Phase 1 adds portfolios and accounts &mdash; see{' '}
          <code className="font-mono text-xs">docs/roadmap.md</code>.
        </p>
      </div>
    </main>
  );
}
