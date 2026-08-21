import { getCurrentUser } from '@/lib/auth';
import { buildInstrumentSearchTasks } from '@/lib/instrument-search';

/**
 * The instrument combobox's one and only search endpoint (`transactions/
 * instrument-combobox.tsx`). Every source `buildInstrumentSearchTasks`
 * builds is awaited concurrently and streamed to the client as NDJSON — one
 * `{ options: [...] }` line per source, written the moment that source
 * settles, in whatever order they actually finish. Nothing about which or
 * how many sources exist crosses this boundary: the client reads a stream of
 * option batches until it closes, never a source name.
 *
 * A plain Route Handler rather than a Server Action: Next.js queues
 * same-client Server Action calls, so four independent search actions ran
 * one after another rather than in parallel, and a stale one held up every
 * newer keystroke's request behind it with no way to cancel it. A `fetch()`
 * here is ordinary HTTP — concurrent, and abortable from the client via
 * `AbortController` (`instrument-combobox.tsx` aborts the previous request
 * the moment a new one starts).
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (user === null) return new Response(null, { status: 401 });

  const query = new URL(request.url).searchParams.get('q') ?? '';
  const tasks = buildInstrumentSearchTasks(query);

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await Promise.all(
        tasks.map(async (task) => {
          const options = await task();
          if (cancelled) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ options })}\n`));
          } catch {
            // The client disconnected between the check above and this write; nothing left to do.
          }
        }),
      );
      if (!cancelled) controller.close();
    },
    // Fires when the client aborts (`instrument-combobox.tsx`'s
    // `AbortController`) or navigates away — stops writing to a controller
    // that Next.js has already closed on its end. The tasks already in
    // flight are left to resolve on their own rather than cancelled: none of
    // them do anything but read, so letting them finish costs nothing and
    // keeps the providers' own caches warm for the next request.
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
