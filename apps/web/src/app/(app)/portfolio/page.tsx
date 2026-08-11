import { getDictionary } from '@/lib/i18n/server';

export default async function PortfolioPage() {
  const dictionary = await getDictionary();

  return (
    <div className="flex h-full flex-col items-start gap-2">
      <h1 className="text-lg font-semibold">{dictionary.nav.portfolio}</h1>
      <p className="text-muted-foreground text-sm">{dictionary.placeholder.portfolio}</p>
    </div>
  );
}
