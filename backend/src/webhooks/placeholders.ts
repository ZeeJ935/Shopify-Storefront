import type { TopicRouter, WebhookHandler } from "./router.js";
import { resourceIdFromPayload } from "./payload.js";

const PLACEHOLDER_TOPICS = [
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

export function registerPlaceholders(router: TopicRouter, log?: PlaceholderLog): void {
  const handler = createPlaceholderHandler(log);
  for (const topic of PLACEHOLDER_TOPICS) {
    router.register(topic, handler);
  }
  router.registerPrefix("fulfillment_orders/", handler);
}
