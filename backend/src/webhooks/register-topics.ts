/**
 * App-managed webhook topics to create via Admin API.
 *
 * Catalog topics (products/*, collections/*, inventory_levels/update) are NOT listed:
 * they are already subscribed manually in Shopify admin. App subscriptions cannot see
 * those, so registering them again would double-deliver every event.
 *
 * fulfillments/create|update need the read_fulfillments scope (added in the app version
 * that ships fulfillment sync); registration fails for them until it is approved.
 */
export const APP_REGISTER_TOPICS = [
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
  // Exact Shopify topic strings only — do not invent aliases if one is rejected.
  "fulfillment_orders/order_routing_complete",
  "fulfillment_orders/cancelled",
  "fulfillment_orders/moved",
  "fulfillment_orders/split",
  "fulfillment_orders/merged",
  "fulfillment_orders/placed_on_hold",
  "fulfillment_orders/hold_released",
  "fulfillment_orders/fulfillment_request_submitted",
  "fulfillment_orders/fulfillment_request_accepted",
  "fulfillment_orders/fulfillment_request_rejected",
  "fulfillment_orders/scheduled_fulfillment_order_ready",
  "fulfillment_orders/rescheduled",
] as const;

/** REST/Admin header form → GraphQL WebhookSubscriptionTopic enum. */
export function topicToGraphqlEnum(topic: string): string {
  return topic.toUpperCase().replace(/\//g, "_");
}

/** Map Admin API topic (enum or slash form) back to slash form when known. */
export function normalizeSubscriptionTopic(value: string): string {
  if (value.includes("/")) return value;
  const upper = value.toUpperCase();
  for (const topic of APP_REGISTER_TOPICS) {
    if (topicToGraphqlEnum(topic) === upper) return topic;
  }
  return value;
}
