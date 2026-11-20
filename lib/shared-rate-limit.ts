import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createRateLimiter, type RateLimitResult } from "./rate-limit";

/** Checks one request: `bucket` groups routes, `key` is the client, `limit` is per window. */
export type LimitCheck = (bucket: string, key: string, limit: number) => Promise<RateLimitResult>;

/** The part of @upstash/ratelimit we use; tests pass a fake. */
export type SlidingLimiter = {
  limit(identifier: string): Promise<{ success: boolean; reset: number; reason?: string }>;
};

export type MakeLimiter = (bucket: string, limit: number, windowMs: number) => SlidingLimiter;

type Env = { UPSTASH_REDIS_REST_URL?: string; UPSTASH_REDIS_REST_TOKEN?: string };

/** Upstash sliding window. Short timeout and one retry, so a Redis outage can't stall every request. */
function upstashLimiterFactory(env: Required<Env>): MakeLimiter {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    retry: { retries: 1, backoff: () => 100 },
  });
  return (bucket, limit, windowMs) =>
    new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${Math.round(windowMs / 1000)} s`),
      prefix: `zj-rl:${bucket}`,
      // Past this, Upstash lets the request through (reason "timeout"): fail open.
      timeout: 1000,
      analytics: false,
      // Remembers clients already blocked in this instance, saving a Redis call.
      ephemeralCache: new Map(),
    });
}

/**
 * Rate limits shared across all server instances (Upstash Redis, sliding window)
 * when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set; otherwise the
 * in-memory limiter from lib/rate-limit.ts (local dev).
 *
 * If Redis is unreachable the request is allowed (fail open) and the error logged,
 * at most once a minute so an outage doesn't flood the logs.
 */
export function createSharedRateLimiter({
  env,
  windowMs,
  makeLimiter,
  log = (message: string) => console.error(message),
  now = Date.now,
}: {
  env: Env;
  windowMs: number;
  makeLimiter?: MakeLimiter;
  log?: (message: string) => void;
  now?: () => number;
}): { mode: "redis" | "memory"; check: LimitCheck } {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    const memory = createRateLimiter();
    return {
      mode: "memory",
      check: async (bucket, key, limit) => memory(`${bucket}:${key}`, limit, windowMs, now()),
    };
  }

  const make = makeLimiter ?? upstashLimiterFactory({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token });
  const limiters = new Map<string, SlidingLimiter>();
  let lastLog = -Infinity;
  const failOpen = (reason: string): RateLimitResult => {
    if (now() - lastLog >= 60_000) {
      lastLog = now();
      log(`[rate-limit] Redis unavailable, allowing requests: ${reason}`);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  };

  return {
    mode: "redis",
    async check(bucket, key, limit) {
      const id = `${bucket}:${limit}`;
      let limiter = limiters.get(id);
      if (!limiter) {
        limiter = make(bucket, limit, windowMs);
        limiters.set(id, limiter);
      }
      try {
        const result = await limiter.limit(key);
        if (result.reason === "timeout") return failOpen("timed out");
        if (result.success) return { allowed: true, retryAfterSeconds: 0 };
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((result.reset - now()) / 1000)) };
      } catch (error) {
        return failOpen(error instanceof Error ? error.message.slice(0, 200) : "unknown error");
      }
    },
  };
}
