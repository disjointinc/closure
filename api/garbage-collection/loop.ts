/**
 * loop.ts -- the production garbage-collection loop. Each collector is one
 * pass that deletes a kind of resource slated for deletion; the loop runs
 * every collector on an interval, isolating errors per collector so one
 * failing pass never blocks the others.
 *
 * Test-suite resources are deliberately NOT collected here: suites collect
 * their own marked resources directly (test-suite-resources.ts), so no
 * test-scoped pass is ever registered in this loop.
 */
type Collector = { name: string; collect: () => Promise<void> };

/* Resources slated for deletion, one collector per kind. Empty today;
 * register production collectors here as they're introduced. */
const collectors: Collector[] = [];

const GARBAGE_COLLECTION_INTERVAL_MS = 60 * 60 * 1000;

/** One round of every registered collector. */
export async function collectGarbage(): Promise<void> {
  for (const { name, collect } of collectors) {
    try {
      await collect();
    } catch (error) {
      console.error(`garbage collection pass failed: ${name}`, error);
    }
  }
}

/**
 * Start the periodic loop. A no-op until a collector is registered, so
 * production runs no garbage collection today. Interval is unref'd.
 */
export function startGarbageCollectionLoop(): void {
  if (collectors.length === 0) {
    return;
  }
  const interval = setInterval(() => {
    collectGarbage().catch((error) =>
      console.error("garbage collection failed", error),
    );
  }, GARBAGE_COLLECTION_INTERVAL_MS);
  interval.unref();
}
