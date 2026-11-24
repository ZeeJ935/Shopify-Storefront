import type pg from "pg";
import type { InventorySource } from "../inventory/types.js";
import type { InventoryStore } from "../inventory/store.js";
import type { WarehouseAdapter } from "./adapter.js";
import { warehouseDiff } from "./diff.js";

/** Most levels refreshed per run (one live Admin read each; no bulk operations). */
export const RECONCILE_MAX_LEVELS = 500;

/**
 * Re-fetches Shopify's live level for every mapped warehouse row (stored via upsertLevel,
 * so shouldApply ordering holds), then records how many rows still differ.
 */
export async function reconcileWarehouse(deps: {
  pool: pg.Pool;
  adapter: WarehouseAdapter;
  source: InventorySource;
  store: InventoryStore;
  maxDecrease: number;
}): Promise<{ refreshed: number; differences: number }> {
  const before = await warehouseDiff(deps.adapter, deps.pool, { maxDecrease: deps.maxDecrease });
  let refreshed = 0;
  for (const row of before.filter((r) => r.inventoryItemShopifyId && r.locationName !== null).slice(0, RECONCILE_MAX_LEVELS)) {
    const remote = await deps.source.inventoryLevel(row.inventoryItemShopifyId!, row.locationShopifyId);
    if (!remote) continue;
    const itemId = await deps.store.ensureItemId(remote.itemShopifyId);
    const locationId = await deps.store.ensureLocationId(remote.locationShopifyId);
    await deps.store.upsertLevel({ itemId, locationId, itemShopifyId: remote.itemShopifyId, locationShopifyId: remote.locationShopifyId, level: remote, source: "sync" });
    refreshed++;
  }
  const after = await warehouseDiff(deps.adapter, deps.pool, { maxDecrease: deps.maxDecrease });
  const differences = after.filter((r) => r.status === "differs" || r.status === "large_decrease").length;
  await deps.pool.query(
    `insert into warehouse_state (id, last_reconcile_at, differences) values (1, now(), $1)
     on conflict (id) do update set last_reconcile_at = now(), differences = excluded.differences`,
    [differences],
  );
  return { refreshed, differences };
}
