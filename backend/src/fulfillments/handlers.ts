import { toOrderGid } from "../orders/ids.js";
import type { WebhookEvent, WebhookHandler } from "../webhooks/router.js";
import { refreshOrderFulfillments, type RefreshDeps } from "./sync.js";

export type FulfillmentHandlerDeps = RefreshDeps & {
  /** Topic + ids only (no payload fields). */
  logSkip?: (line: { topic: string; id: string | number | null; handler: string; reason: string }) => void;
};

/** Stored payload for fulfillment_orders/*: `{ ids: [FulfillmentOrder GIDs] }`. */
function fulfillmentOrderIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const ids = (payload as { ids?: unknown }).ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** Stored payload for fulfillments/*: `{ id, order_id }`. */
function fulfillmentOrderId(payload: unknown): string | number | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as { order_id?: unknown }).order_id;
  return typeof v === "string" || typeof v === "number" ? v : null;
}

/**
 * Admin-backed, idempotent handlers. Both re-fetch the whole order's fulfillment data
 * (webhook payloads are never trusted for business data).
 */
export function createFulfillmentHandlers(deps: FulfillmentHandlerDeps): {
  fulfillmentOrder: WebhookHandler;
  fulfillment: WebhookHandler;
} {
  async function refresh(event: WebhookEvent, orderGid: string, id: string | number | null) {
    const result = await refreshOrderFulfillments(deps, orderGid);
    if (result !== "refreshed") deps.logSkip?.({ topic: event.topic, id, handler: "fulfillments", reason: result });
  }

  return {
    fulfillmentOrder: {
      name: "fulfillments",
      async handle(event) {
        // All fulfillment orders in one event (split/move/merge) belong to the same order.
        for (const foId of fulfillmentOrderIds(event.payload)) {
          const orderGid = await deps.source.orderIdForFulfillmentOrder(foId);
          if (orderGid) return refresh(event, orderGid, foId);
        }
        deps.logSkip?.({ topic: event.topic, id: null, handler: "fulfillments", reason: "no_accessible_fulfillment_order" });
      },
    },
    fulfillment: {
      name: "fulfillments",
      async handle(event) {
        const orderId = fulfillmentOrderId(event.payload);
        if (orderId == null) {
          deps.logSkip?.({ topic: event.topic, id: null, handler: "fulfillments", reason: "no_order_id" });
          return;
        }
        await refresh(event, toOrderGid(orderId), orderId);
      },
    },
  };
}
