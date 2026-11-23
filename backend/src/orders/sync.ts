import { ordersUpdatedSinceIso } from "./admin-source.js";
import type { OrdersStore } from "./store.js";
import type { OrdersSource } from "./types.js";

export type OrdersSyncDeps = {
  source: OrdersSource;
  store: OrdersStore;
  /** Override for tests. Default: now − 60 days. */
  updatedSince?: string;
  /** Called after an upsert that needs fulfillment data refreshed (new/changed/never synced). */
  onOrderChanged?: (orderShopifyId: string) => Promise<unknown>;
};

export type FullSyncResult = {
  orders: number;
  applied: number;
};

/** Pages orders in the 60-day window; never deletes older orders. */
export async function fullSync(deps: OrdersSyncDeps): Promise<FullSyncResult> {
  const updatedSince = deps.updatedSince ?? ordersUpdatedSinceIso();
  let orderCount = 0;
  let applied = 0;
  let after: string | null = null;

  for (;;) {
    const page = await deps.source.ordersPage(after, updatedSince);
    for (const order of page.orders) {
      orderCount++;
      const result = await deps.store.upsertOrder(order);
      if (result.applied) applied++;
      if (result.refreshFulfillments) await deps.onOrderChanged?.(order.shopifyId);
    }
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }

  await deps.store.finishFullSync();
  return { orders: orderCount, applied };
}
