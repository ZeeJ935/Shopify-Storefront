import { createHash } from "node:crypto";
import type { InventorySource } from "../inventory/types.js";
import { ShopifyUserErrors, type ShopifyAdmin } from "../shopify-admin/index.js";

export type LiveLevel = { onHand: number; available: number; committed: number };
export type SetResult = "ok" | "stale";

/** What the push job needs from Shopify. Faked in tests. */
export type StockShopify = {
  /** Live quantities for one item at one location; null when the item isn't stocked there. */
  liveLevel(itemGid: string, locationGid: string): Promise<LiveLevel | null>;
  /** Compare-and-set on_hand. "stale" when Shopify's on_hand ≠ changeFromQuantity (e.g. a sale). */
  setOnHand(input: { itemGid: string; locationGid: string; quantity: number; changeFromQuantity: number; idempotencyKey: string; referenceDocumentUri: string }): Promise<SetResult>;
};

export const STALE_CODE = "CHANGE_FROM_QUANTITY_STALE";

/**
 * Admin 2026-10: name "on_hand", compare-and-set via changeFromQuantity, and the required
 * @idempotent directive. No bulk operations.
 */
export const SET_ON_HAND_MUTATION = `mutation SetOnHand($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    inventoryAdjustmentGroup { changes { name delta quantityAfterChange } }
    userErrors { code field message }
  }
}`;

export function createStockShopify(admin: ShopifyAdmin, inventory: InventorySource): StockShopify {
  return {
    async liveLevel(itemGid, locationGid) {
      const level = await inventory.inventoryLevel(itemGid, locationGid);
      return level ? { onHand: level.onHand, available: level.available, committed: level.committed } : null;
    },
    async setOnHand(i) {
      try {
        await admin.request(SET_ON_HAND_MUTATION, {
          idempotencyKey: i.idempotencyKey,
          input: {
            name: "on_hand",
            reason: "correction",
            referenceDocumentUri: i.referenceDocumentUri,
            quantities: [{ inventoryItemId: i.itemGid, locationId: i.locationGid, quantity: i.quantity, changeFromQuantity: i.changeFromQuantity }],
          },
        });
        return "ok";
      } catch (error) {
        if (error instanceof ShopifyUserErrors && error.codes.includes(STALE_CODE)) return "stale";
        throw error;
      }
    },
  };
}

/**
 * Deterministic UUID (v5-style, SHA-1) per push × item × location × attempt × from. A job
 * retry after a crash reuses the key, so Shopify returns its cached result instead of
 * setting twice; a conflict retry (new from) gets a new key.
 */
export function pushIdempotencyKey(parts: { pushId: number; itemGid: string; locationGid: string; attempt: number; from: number }): string {
  const h = createHash("sha1").update(`zj-warehouse-push|${parts.pushId}|${parts.itemGid}|${parts.locationGid}|${parts.attempt}|${parts.from}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
