import type { FastifyInstance } from "fastify";
import { safeError } from "../errors.js";
import type { QueueHealth } from "../db/queue-health.js";
import type { AdminApiHealth } from "../shopify-admin/index.js";

export type HealthDetails = {
  /** When the last full catalog sync finished; null if never. */
  lastSyncAt: Date | null;
  /** When the last full inventory sync finished; null if never. */
  inventoryLastSyncAt?: Date | null;
  /** When the last full orders sync finished; null if never. */
  ordersLastSyncAt?: Date | null;
  /** Webhook events that failed their last retry in the past 24 hours. */
  failedWebhooks24h: number;
  /** Webhook events neither processed nor failed, received over STUCK_AFTER_MINUTES ago. */
  stuckWebhooks?: number;
  /** received_at of the oldest stuck event; null if none. */
  oldestStuckWebhookAt?: Date | null;
  /** pg-boss depth and oldest waiting job per queue. */
  queues?: QueueHealth[];
  warehouseLastReconcileAt?: Date | null;
  warehouseDifferences?: number | null;
};

/** queuesWarning thresholds (warning fields only; /health never 503s for these). */
export const QUEUE_DEPTH_WARN = 100;
export const QUEUE_AGE_WARN_SECONDS = 15 * 60;

export function queuesWarning(queues: QueueHealth[]): boolean {
  return queues.some((q) => q.queued > QUEUE_DEPTH_WARN || (q.oldestQueuedSeconds ?? 0) > QUEUE_AGE_WARN_SECONDS);
}

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
    const inventoryLastSyncAt = d?.inventoryLastSyncAt ?? null;
    const ordersLastSyncAt = d?.ordersLastSyncAt ?? null;
    return {
      ok: true,
      db: "up",
      catalog: {
        lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
        stale: !lastSyncAt || now() - lastSyncAt.getTime() > STALE_AFTER_MS,
      },
      inventory: {
        lastSyncAt: inventoryLastSyncAt ? inventoryLastSyncAt.toISOString() : null,
        stale: !inventoryLastSyncAt || now() - inventoryLastSyncAt.getTime() > STALE_AFTER_MS,
      },
      orders: {
        lastSyncAt: ordersLastSyncAt ? ordersLastSyncAt.toISOString() : null,
        stale: !ordersLastSyncAt || now() - ordersLastSyncAt.getTime() > STALE_AFTER_MS,
      },
      webhooks: {
        failedLast24h: d ? d.failedWebhooks24h : null,
        stuck: d ? (d.stuckWebhooks ?? 0) : null,
        oldestStuckAt: d?.oldestStuckWebhookAt ? d.oldestStuckWebhookAt.toISOString() : null,
      },
      ...(d?.queues
        ? {
            queues: Object.fromEntries(d.queues.map(({ name, ...rest }) => [name, rest])),
            queuesWarning: queuesWarning(d.queues),
          }
        : {}),
      ...(d && "warehouseDifferences" in d
        ? {
            warehouse: {
              lastReconcileAt: d.warehouseLastReconcileAt ? d.warehouseLastReconcileAt.toISOString() : null,
              differences: d.warehouseDifferences ?? null,
            },
          }
        : {}),
      ...(admin ? { adminApi: admin } : {}),
    };
  });
}
