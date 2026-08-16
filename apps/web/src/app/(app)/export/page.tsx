import { Button } from '@/components/ui/button';
import { getDictionary } from '@/lib/i18n/server';

/**
 * Two downloads, nothing else — `(app)/layout.tsx` already guards every route
 * under here, and this page reads no scoped data itself, only links to
 * `/api/export` which does. Real `<a download>` links rather than a client
 * fetch, so the browser's own download handling applies (docs/ui.md: "every
 * control is a real link").
 */
export default async function ExportPage() {
  const dictionary = await getDictionary();
  const strings = dictionary.export;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{strings.title}</h1>
      <p className="text-muted-foreground max-w-md text-sm">{strings.description}</p>

      <div className="flex max-w-md flex-col items-start gap-2">
        <Button nativeButton={false} render={<a href="/api/export?format=csv" download />}>
          {strings.downloadCsv}
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href="/api/export?format=json" download />}
        >
          {strings.downloadJson}
        </Button>
      </div>
    </div>
  );
}
