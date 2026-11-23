import { CATALOG_TOPICS } from "./topics.js";

/** Topics that may carry customer/order PII — store only `{ id }`, never the raw body. */
export const STRIPPED_PAYLOAD_TOPICS: ReadonlySet<string> = new Set([
  "inventory_items/update",
  "locations/create",
  "locations/update",
  "locations/delete",
  "orders/create",
  "orders/paid",
  "orders/updated",
  "orders/cancelled",
]);

/** fulfillments/*: keep `{ id, order_id }` (order id is needed to re-fetch; not personal data). */
const FULFILLMENT_TOPICS: ReadonlySet<string> = new Set(["fulfillments/create", "fulfillments/update"]);

const FULFILLMENT_ORDER_GID = /^gid:\/\/shopify\/FulfillmentOrder\/\d+$/;
const MAX_FULFILLMENT_ORDER_IDS = 20;

/**
 * fulfillment_orders/* payloads nest ids (`fulfillment_order`, `original_fulfillment_order`,
 * `moved_fulfillment_order`, `fulfillment_order_merges[]`, ...). Collect only the
 * FulfillmentOrder GIDs; nothing else is kept.
 */
export function fulfillmentOrderIdsFromPayload(payload: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (found.size >= MAX_FULFILLMENT_ORDER_IDS || depth > 6 || value == null) return;
    if (typeof value === "string") {
      if (FULFILLMENT_ORDER_GID.test(value)) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    if (typeof value === "object") for (const v of Object.values(value)) visit(v, depth + 1);
  };
  visit(payload, 0);
  return [...found];
}

function isFulfillmentOrderTopic(topic: string): boolean {
  return topic.startsWith("fulfillment_orders/");
}

/** Pull a resource id from a Shopify webhook JSON body without keeping other fields. */
export function resourceIdFromPayload(payload: unknown): string | number | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.id === "number" || typeof obj.id === "string") return obj.id;
  if (typeof obj.admin_graphql_api_id === "string") return obj.admin_graphql_api_id;
  return null;
}

/**
 * What to persist on webhook_events.
 * Catalog: full payload. Inventory/location/order topics: `{ id }`. fulfillments/*:
 * `{ id, order_id }`. fulfillment_orders/*: `{ ids }` (FulfillmentOrder GIDs). Unknown: null.
 */
export function payloadForStorage(topic: string, payload: unknown, handled: boolean): unknown {
  if (!handled) return null;
  if (CATALOG_TOPICS.has(topic)) return payload;
  if (STRIPPED_PAYLOAD_TOPICS.has(topic)) return { id: resourceIdFromPayload(payload) };
  if (FULFILLMENT_TOPICS.has(topic)) {
    const orderId = payload && typeof payload === "object" ? (payload as Record<string, unknown>).order_id : null;
    return {
      id: resourceIdFromPayload(payload),
      order_id: typeof orderId === "number" || typeof orderId === "string" ? orderId : null,
    };
  }
  if (isFulfillmentOrderTopic(topic)) return { ids: fulfillmentOrderIdsFromPayload(payload) };
  return null;
}
