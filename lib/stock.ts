/** Shopify's per-line ceiling, and our own cap for untracked/backorder items. */
export const MAX_LINE_QUANTITY = 99;
/** At or below this many units we tell shoppers "Only N left". */
export const LOW_STOCK_THRESHOLD = 5;

export type StockFields = {
  availableForSale: boolean;
  /** True when the variant is at zero but set to keep selling (backorder). */
  currentlyNotInStock?: boolean;
  quantityAvailable?: number | null;
};

/**
 * Units actually on hand when inventory is tracked and enforced, else null
 * (untracked, backorder, or not fetched). Shopify's cart warnings remain the
 * final word; this only keeps pickers honest.
 */
export function trackedQuantity(stock: StockFields): number | null {
  if (!stock.availableForSale || stock.currentlyNotInStock) {
    return null;
  }
  const quantity = stock.quantityAvailable;
  return typeof quantity === "number" && quantity > 0 ? quantity : null;
}

/** Highest quantity a shopper may hold of this variant (0 when sold out). */
export function maxPurchasable(stock: StockFields): number {
  if (!stock.availableForSale) {
    return 0;
  }
  return Math.min(MAX_LINE_QUANTITY, trackedQuantity(stock) ?? MAX_LINE_QUANTITY);
}

export function isBackorder(stock: StockFields): boolean {
  return stock.availableForSale && stock.currentlyNotInStock === true;
}

/** "Only N left" count, or null when stock isn't low or isn't tracked. */
export function lowStockCount(stock: StockFields): number | null {
  const quantity = trackedQuantity(stock);
  return quantity !== null && quantity <= LOW_STOCK_THRESHOLD ? quantity : null;
}

export function hasStockIssues(
  lines: { merchandise: StockFields; quantity: number }[],
): boolean {
  return lines.some(
    (line) => lineStockIssue(line.merchandise, line.quantity) !== null,
  );
}

/** A cart line problem that must be fixed before checkout, or null. */
export function lineStockIssue(
  stock: StockFields,
  quantity: number,
): string | null {
  if (!stock.availableForSale) {
    return "Sold out. Remove it to check out.";
  }
  const available = trackedQuantity(stock);
  if (available !== null && quantity > available) {
    return `Only ${available} available. Lower the quantity to check out.`;
  }
  return null;
}
