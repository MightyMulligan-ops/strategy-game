export type DeadlineWorkerConfig = Readonly<{ intervalMs: number; batchSize: number; timeoutMs: number }>;
export function deadlineWorkerConfig(env: Record<string, string | undefined>): DeadlineWorkerConfig {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const text = env[name]; const value = text === undefined ? fallback : /^\d+$/.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid deadline worker configuration");
    return value;
  };
  return Object.freeze({ intervalMs: integer("TURN_DEADLINE_INTERVAL_MS", 1000, 100, 60_000),
    batchSize: integer("TURN_DEADLINE_BATCH_SIZE", 20, 1, 100), timeoutMs: integer("TURN_DEADLINE_TIMEOUT_MS", 5000, 100, 15_000) });
}
export type DeadlineStore = { dueMatches: (limit: number) => Promise<readonly string[]>; closeDue: (id: string, timeout: number) => Promise<boolean> };
/** One bounded batch at a time. Each next tick scans persisted overdue OPEN turns afresh. */
export function deadlineWorker(store: DeadlineStore, config: DeadlineWorkerConfig, warn: () => void) {
  let stopped = true, timer: ReturnType<typeof setTimeout> | undefined, pending: Promise<void> = Promise.resolve();
  const tick = async () => {
    let failed = false;
    try {
      const ids = await store.dueMatches(config.batchSize);
      for (const id of ids.slice(0, config.batchSize)) {
        if (stopped) break;
        try { await store.closeDue(id, config.timeoutMs); } catch { failed = true; }
      }
    } catch { failed = true; }
    if (failed) warn(); // One constant, private-data-free log per batch, never error/payload contents.
    if (!stopped) { timer = setTimeout(run, config.intervalMs); timer.unref(); }
  };
  const run = () => { pending = tick(); };
  return { start() { if (!stopped) return; stopped = false; timer = setTimeout(run, 0); timer.unref(); },
    async stop() { stopped = true; clearTimeout(timer); await pending; } };
}

export function movementLifecycleStore(closures:DeadlineStore,resolutions:{dueMatches:(limit:number)=>Promise<readonly string[]>;resolveClosed:(id:string,timeout:number)=>Promise<boolean>}):DeadlineStore{
 return {async dueMatches(limit){const ready=await resolutions.dueMatches(limit);return [...new Set([...ready,...await closures.dueMatches(limit)])].slice(0,limit)},
 async closeDue(id,timeout){const closed=await closures.closeDue(id,timeout);return await resolutions.resolveClosed(id,timeout)||closed}};
}
