import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { DEFAULT_LIMIT, InvalidCursorError, MAX_LIMIT, getOrderDetail, listOrders } from "../orders/query.js";

export type OrdersRouteDeps = {
  pool: pg.Pool;
  enqueueFullSync?: (reason: string) => Promise<unknown>;
};

type Query = Record<string, string | string[] | undefined>;
const one = (q: Query, name: string) => {
  const v = q[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || null;
};

export function ordersRoutes(app: FastifyInstance, deps: OrdersRouteDeps) {
  app.get("/v1/orders", async (request, reply) => {
    const q = request.query as Query;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(one(q, "limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
    try {
      return await listOrders(deps.pool, {
        status: one(q, "status"),
        financialStatus: one(q, "financial_status"),
        fulfillmentStatus: one(q, "fulfillment_status"),
        from: one(q, "from"),
        to: one(q, "to"),
        sku: one(q, "sku"),
        cursor: one(q, "cursor"),
        limit,
      });
    } catch (error) {
      if (error instanceof InvalidCursorError) return reply.code(400).send({ error: "invalid_cursor" });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id", async (request, reply) => {
    const order = await getOrderDetail(deps.pool, request.params.id);
    if (!order) return reply.code(404).send({ error: "not_found" });
    return order;
  });

  app.post("/v1/orders/sync", async (_request, reply) => {
    if (!deps.enqueueFullSync) return reply.code(503).send({ error: "orders_sync_not_configured" });
    await deps.enqueueFullSync("manual");
    return reply.code(202).send({ queued: true });
  });
}
