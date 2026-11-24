/** Physical stock for one SKU at one Shopify location, as the warehouse reports it. */
export type WarehouseStock = { sku: string; locationShopifyId: string; quantity: number; updatedAt: string };

/**
 * What the sync needs from a warehouse. Read-only by design: the warehouse is the source
 * of truth for physical stock and we only copy it into Shopify (no reserve/release).
 */
export interface WarehouseAdapter {
  getStock(sku: string): Promise<WarehouseStock[]>;
  listStock(): Promise<WarehouseStock[]>;
}
