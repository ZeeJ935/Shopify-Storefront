import type { FastifyInstance } from "fastify";
import { safeError } from "../errors.js";
import type { AdminApiHealth } from "../shopify-admin/index.js";

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
 * catalog sync, failed webhooks, or Admin API warning are fields, not a failure.
 */
export function healthRoutes(
  app: FastifyInstance,
  pingDb: () => Promise<void>,
  details?: () => Promise<HealthDetails>,
  now: () => number = Date.now,
  adminApi?: () => Promise<AdminApiHealth>,
) {
  app.get("/health", async (_request, reply) => {
    try {
      await pingDb();
    } catch (error) {
      app.log.error({ err: safeError(error) }, "database ping failed");
      return reply.code(503).send({ ok: false, db: "down" });
    }

    let admin: AdminApiHealth | undefined;
    if (adminApi) {
      try {
        admin = await adminApi();
      } catch (error) {
        app.log.warn({ err: safeError(error) }, "admin API health unavailable");
        admin = { ok: false, warning: "admin health check failed" };
      }
    }

    if (!details) {
      return admin ? { ok: true, db: "up", adminApi: admin } : { ok: true, db: "up" };
    }

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
      ...(admin ? { adminApi: admin } : {}),
    };
  });
}
