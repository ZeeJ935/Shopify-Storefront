import type { TopicRouter, WebhookHandler } from "./router.js";
import { resourceIdFromPayload } from "./payload.js";

const ORDER_PLACEHOLDERS = [
  "orders/create",
  "orders/paid",
  "orders/updated",
  "orders/cancelled",
] as const;

const FULFILLMENT_PLACEHOLDERS = ["fulfillments/create", "fulfillments/update"] as const;

const LOCATION_AND_ITEM_PLACEHOLDERS = [
  "inventory_items/update",
  "locations/create",
  "locations/update",
  "locations/delete",
] as const;

export type PlaceholderLog = (line: { topic: string; id: string | number | null; handler: string }) => void;

/** Log topic + id only; no writes. Later steps replace these with real handlers. */
export function createPlaceholderHandler(log: PlaceholderLog = () => {}): WebhookHandler {
  return {
    name: "placeholder",
    async handle(event) {
      log({
        topic: event.topic,
        id: resourceIdFromPayload(event.payload),
        handler: "placeholder",
      });
    },
  };
}

export function registerPlaceholders(
  router: TopicRouter,
  log?: PlaceholderLog,
  opts?: { skipLocationAndItem?: boolean; skipOrders?: boolean; skipFulfillments?: boolean },
): void {
  const handler = createPlaceholderHandler(log);
  const topics: string[] = [];
  if (!opts?.skipLocationAndItem) topics.push(...LOCATION_AND_ITEM_PLACEHOLDERS);
  if (!opts?.skipOrders) topics.push(...ORDER_PLACEHOLDERS);
  if (!opts?.skipFulfillments) topics.push(...FULFILLMENT_PLACEHOLDERS);
  for (const topic of topics) {
    router.register(topic, handler);
  }
  if (!opts?.skipFulfillments) router.registerPrefix("fulfillment_orders/", handler);
}
