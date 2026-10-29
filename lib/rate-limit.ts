/**
 * Fixed-window rate limiting, kept in memory.
 *
 * Best effort: on Vercel each server instance keeps its own counts, so this
 * stops runaway scripts and casual abuse, not a distributed attack. A hard
 * global limit needs shared storage (e.g. Upstash Redis) or Vercel Firewall rules.
 */

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSeconds: number;
};

type Window = { count: number; resetAt: number };

export function createRateLimiter({ maxKeys = 10_000 } = {}) {
  const windows = new Map<string, Window>();

  function prune(now: number) {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
    // Still full of live windows: drop the oldest so memory stays bounded.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return function check(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): RateLimitResult {
    let window = windows.get(key);

    if (!window || window.resetAt <= now) {
      if (!window && windows.size >= maxKeys) {
        prune(now);
      }
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }

    window.count += 1;
    if (window.count <= limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  };
}

/** True when a request's Origin header matches the site's own origin. */
export function isSameOrigin(originHeader: string | null, siteOrigin: string) {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === siteOrigin;
  } catch {
    return false;
  }
}
