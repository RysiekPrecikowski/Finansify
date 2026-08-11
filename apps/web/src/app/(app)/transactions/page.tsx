import { getDictionary } from '@/lib/i18n/server';

export default async function TransactionsPage() {
  const dictionary = await getDictionary();

  return (
    <div className="flex h-full flex-col items-start gap-2">
      <h1 className="text-lg font-semibold">{dictionary.nav.transactions}</h1>
      <p className="text-muted-foreground text-sm">{dictionary.placeholder.transactions}</p>
    </div>
  );
}
