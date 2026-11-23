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
  "fulfillments/create",
  "fulfillments/update",
]);

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
 * Catalog: full payload (as today). Handled non-catalog: `{ id }` only. Unknown: null.
 */
export function payloadForStorage(topic: string, payload: unknown, handled: boolean): unknown {
  if (!handled) return null;
  if (CATALOG_TOPICS.has(topic)) return payload;
  if (STRIPPED_PAYLOAD_TOPICS.has(topic) || isFulfillmentOrderTopic(topic)) {
    return { id: resourceIdFromPayload(payload) };
  }
  return null;
}
