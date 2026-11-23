import type { FulfillmentsStore } from "./store.js";
import type { FulfillmentsSource } from "./types.js";

export type RefreshDeps = {
  source: FulfillmentsSource;
  store: FulfillmentsStore;
  /**
   * Fetches + upserts the order itself when it is not in Postgres yet (e.g. a
   * fulfillment webhook arrived before the orders webhook). Returns false if Shopify
   * has no accessible order.
   */
  ensureOrder?: (orderShopifyId: string) => Promise<boolean>;
};

export type RefreshResult = "refreshed" | "order_not_accessible" | "order_missing";

/** Re-fetches an order's fulfillment orders + fulfillments from Admin and stores them. Idempotent. */
export async function refreshOrderFulfillments(deps: RefreshDeps, orderShopifyId: string): Promise<RefreshResult> {
  const startedAt = await deps.store.now();
  const remote = await deps.source.forOrder(orderShopifyId);
  if (!remote) return "order_not_accessible";

  let result = await deps.store.replaceForOrder(remote, startedAt);
  if (result.orderMissing && deps.ensureOrder) {
    if (!(await deps.ensureOrder(orderShopifyId))) return "order_not_accessible";
    result = await deps.store.replaceForOrder(remote, startedAt);
  }
  return result.orderMissing ? "order_missing" : "refreshed";
}
