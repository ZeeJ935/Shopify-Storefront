/** Fixed-window, in-memory rate limiter (per process). Enough for a handful of staff. */
export type RateLimiter = {
  /** Counts one attempt; returns retry-after seconds when over the limit, else 0. */
  hit(key: string): number;
};

export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number; maxKeys?: number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= opts.windowMs) {
        if (!w && windows.size >= maxKeys) {
          // Bounded memory: drop expired windows, and the oldest if still full.
          for (const [k, v] of windows) if (t - v.start >= opts.windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count++;
      return w.count > opts.max ? Math.ceil((w.start + opts.windowMs - t) / 1000) : 0;
    },
  };
}
