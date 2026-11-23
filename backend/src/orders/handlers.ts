import { toOrderGid } from "./ids.js";
import type { OrdersStore } from "./store.js";
import type { OrdersSource } from "./types.js";
import type { WebhookEvent, WebhookHandler } from "../webhooks/router.js";

export type OrdersHandlerDeps = {
  source: OrdersSource;
  store: OrdersStore;
  /** Log topic + id when an old/inaccessible order is skipped (no PII). */
  logSkip?: (line: { topic: string; id: string | number | null; handler: string }) => void;
};

function orderIdFromPayload(payload: unknown): string | number | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as Record<string, unknown>).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * Idempotent Admin-backed order webhook handler.
 * Uses payload id only; re-fetches from Admin. Null/access → skip (processed, no retry/Sentry).
 */
export function createOrdersHandlers(deps: OrdersHandlerDeps): WebhookHandler {
  return {
    name: "orders",
    async handle(event: WebhookEvent) {
      const id = orderIdFromPayload(event.payload);
      if (id == null) return;
      const remote = await deps.source.order(toOrderGid(id));
      if (!remote) {
        deps.logSkip?.({ topic: event.topic, id, handler: "orders" });
        return;
      }
      await deps.store.upsertOrder(remote);
    },
  };
}
