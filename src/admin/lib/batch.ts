/**
 * One request per page of the Catalog table, instead of one per cell.
 *
 * The admin-kit Catalog calls a column's `loadData` once per row, and this
 * plugin now contributes two columns backed by the same per-variant lookups
 * (the purchase cost and the SRP margin). Done naively that is `2 x pageSize`
 * requests every time the operator pages or searches - and the cost column
 * already paid one request per row before these two shared a loader, asking the
 * same table for one SKU each.
 *
 * Both admin routes involved accept an exact key set, so the fix is to stop
 * asking one at a time. Every `load()` call inside the same tick lands in one
 * batch: React flushes all the cells' effects in a single pass, so by the time
 * the scheduled flush runs, every visible row of both columns has queued its
 * key. One request comes back and fans out to all of them. De-duplication falls
 * out of the same map - two columns asking for the same SKU put it in the
 * request once.
 *
 * There is deliberately **no cache across batches**. A cost is exactly the kind
 * of thing an operator edits and then expects to see re-read on the next
 * render; coalescing within a tick is a saving, holding a stale figure is a
 * lie.
 *
 * Kept free of the admin SDK (whose module reads `import.meta.env`) so the
 * batching contract is unit-testable in Node, like the rest of `src/admin/lib`.
 */

/**
 * Keys per request. Comfortably above the Catalog's largest page size (100), so
 * in practice a page is always exactly one request, while still capping the
 * query string for a caller that queues more.
 */
export const MAX_KEYS_PER_REQUEST = 100;

/** Resolves an exact set of keys into a value per key. A key with no value is simply absent. */
export type BatchFetcher<TValue> = (keys: string[]) => Promise<Map<string, TValue>>;

/** Defers a flush to the end of the current tick. */
export type FlushScheduler = (flush: () => void) => void;

interface Waiter<TValue> {
  resolve: (value: TValue | null) => void;
  reject: (error: unknown) => void;
}

export interface Batcher<TValue> {
  /**
   * The value for one key, or `null` when the source has none for it.
   *
   * Rejects only when the request itself failed, so a cell can tell "this
   * variant has no cost on file" (a fact worth showing) from "the lookup broke"
   * (an error worth showing differently).
   */
  load: (key: string) => Promise<TValue | null>;
}

/**
 * Build a batcher over a given fetcher. Exported rather than only a module
 * singleton so the batching contract can be asserted with a fake fetcher and a
 * synchronous scheduler.
 */
export function createBatcher<TValue>(
  fetchMany: BatchFetcher<TValue>,
  schedule: FlushScheduler = (flush) => {
    setTimeout(flush, 0);
  },
): Batcher<TValue> {
  const pending = new Map<string, Waiter<TValue>[]>();
  let scheduled = false;

  const runChunk = (chunk: [string, Waiter<TValue>[]][]): void => {
    const keys = chunk.map(([key]) => key);
    fetchMany(keys)
      .then((byKey) => {
        for (const [key, waiters] of chunk) {
          const value = byKey.get(key) ?? null;
          for (const waiter of waiters) {
            waiter.resolve(value);
          }
        }
      })
      .catch((error: unknown) => {
        for (const [, waiters] of chunk) {
          for (const waiter of waiters) {
            waiter.reject(error);
          }
        }
      });
  };

  const flush = (): void => {
    scheduled = false;
    const batch = [...pending.entries()];
    // Cleared before the fetch, so a `load` arriving while this request is in
    // flight opens the next batch instead of joining one already sent.
    pending.clear();
    for (let index = 0; index < batch.length; index += MAX_KEYS_PER_REQUEST) {
      runChunk(batch.slice(index, index + MAX_KEYS_PER_REQUEST));
    }
  };

  return {
    load(key: string): Promise<TValue | null> {
      return new Promise<TValue | null>((resolve, reject) => {
        const waiters = pending.get(key);
        if (waiters) {
          waiters.push({ reject, resolve });
        } else {
          pending.set(key, [{ reject, resolve }]);
        }
        if (!scheduled) {
          scheduled = true;
          schedule(flush);
        }
      });
    },
  };
}
