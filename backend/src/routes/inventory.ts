import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { DEFAULT_LIMIT, InvalidCursorError, MAX_LIMIT, getItemDetail, listLevels, listLocations } from "../inventory/query.js";

export type InventoryRouteDeps = {
  pool: pg.Pool;
  enqueueFullSync?: (reason: string) => Promise<unknown>;
};

type Query = Record<string, string | string[] | undefined>;
const one = (q: Query, name: string) => {
  const v = q[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || null;
};

/** `base` "/v1" (default) or "/admin"; `sync: false` leaves out POST {base}/inventory/sync. */
export function inventoryRoutes(app: FastifyInstance, deps: InventoryRouteDeps, opts: { base?: string; sync?: boolean } = {}) {
  const base = opts.base ?? "/v1";
  app.get(`${base}/inventory/locations`, async () => listLocations(deps.pool));

  app.get(`${base}/inventory/levels`, async (request, reply) => {
    const q = request.query as Query;
    const low = one(q, "low_stock_below");
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(one(q, "limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
    try {
      return await listLevels(deps.pool, {
        sku: one(q, "sku"),
        locationId: one(q, "location_id"),
        lowStockBelow: low != null && Number.isFinite(Number(low)) ? Number(low) : null,
        cursor: one(q, "cursor"),
        limit,
      });
    } catch (error) {
      if (error instanceof InvalidCursorError) return reply.code(400).send({ error: "invalid_cursor" });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>(`${base}/inventory/items/:id`, async (request, reply) => {
    const item = await getItemDetail(deps.pool, request.params.id);
    if (!item) return reply.code(404).send({ error: "not_found" });
    return item;
  });

  if (opts.sync === false) return;
  app.post(`${base}/inventory/sync`, async (_request, reply) => {
    if (!deps.enqueueFullSync) return reply.code(503).send({ error: "inventory_sync_not_configured" });
    await deps.enqueueFullSync("manual");
    return reply.code(202).send({ queued: true });
  });
}
