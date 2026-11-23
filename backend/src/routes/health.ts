import type { FastifyInstance } from "fastify";
import { safeError } from "../errors.js";

export type HealthDetails = {
  /** When the last full catalog sync finished; null if never. */
  lastSyncAt: Date | null;
  /** Webhook events that failed their last retry in the past 24 hours. */
  failedWebhooks24h: number;
};

/** A sync older than this is flagged as stale (nightly + slack for retries and sleep). */
export const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

/**
 * Open endpoint for uptime checks. 503 only when the database is down; a stale
 * catalog sync or failed webhooks are reported as fields, not as a failure.
 */
export function healthRoutes(
  app: FastifyInstance,
  pingDb: () => Promise<void>,
  details?: () => Promise<HealthDetails>,
  now: () => number = Date.now,
) {
  app.get("/health", async (_request, reply) => {
    try {
      await pingDb();
    } catch (error) {
      app.log.error({ err: safeError(error) }, "database ping failed");
      return reply.code(503).send({ ok: false, db: "down" });
    }
    if (!details) return { ok: true, db: "up" };

    let d: HealthDetails | null = null;
    try {
      d = await details();
    } catch (error) {
      app.log.warn({ err: safeError(error) }, "health details unavailable");
    }
    const lastSyncAt = d?.lastSyncAt ?? null;
    return {
      ok: true,
      db: "up",
      catalog: {
        lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
        stale: !lastSyncAt || now() - lastSyncAt.getTime() > STALE_AFTER_MS,
      },
      webhooks: { failedLast24h: d ? d.failedWebhooks24h : null },
    };
  });
}
