// Shopify works out a cart's discounts when the cart changes, not when it's read, so a
// cart left alone can keep showing a discount that has since expired (checkout always
// recalculates). For an untouched cart the bag page sets one line to the quantity it
// already has — Shopify counts that as a change (updatedAt moves) and recalculates,
// while the bag stays exactly as it is. Checked against the Storefront API 2026-10;
// re-saving the same note is ignored and does not recalculate.
// Pure (no Shopify import) so it's unit tested.

/** A cart unchanged for this long is refreshed when the bag page loads. */
export const CART_REFRESH_AFTER_MS = 5 * 60_000;

export function isCartStale(updatedAt: string, nowMs: number): boolean {
  const changed = Date.parse(updatedAt);
  return Number.isFinite(changed) && nowMs - changed >= CART_REFRESH_AFTER_MS;
}

/**
 * Returns the cart refreshed when it's stale, otherwise as fetched. A failed refresh
 * is reported and the fetched cart is used, so the bag never breaks because of it.
 * The refresh itself moves updatedAt forward, which limits it to once per 5 minutes.
 */
export async function withFreshDiscounts<C extends { updatedAt: string }>(
  cart: C,
  refresh: () => Promise<C>,
  onError: (error: unknown) => void,
  nowMs: number = Date.now(),
): Promise<C> {
  if (!isCartStale(cart.updatedAt, nowMs)) return cart;
  try {
    return await refresh();
  } catch (error) {
    onError(error);
    return cart;
  }
}

type RefreshableLine = {
  id: string;
  quantity: number;
  merchandise: { availableForSale: boolean; quantityAvailable: number | null };
};

/**
 * A line safe to re-send at its current quantity: within stock (Shopify would lower an
 * over-stock line) and within the 1–99 the cart accepts. Null = skip the refresh.
 */
export function refreshLine(lines: RefreshableLine[]): { id: string; quantity: number } | null {
  const line = lines.find(
    (l) =>
      l.merchandise.availableForSale &&
      Number.isInteger(l.quantity) &&
      l.quantity >= 1 &&
      l.quantity <= 99 &&
      (l.merchandise.quantityAvailable == null || l.quantity <= l.merchandise.quantityAvailable),
  );
  return line ? { id: line.id, quantity: line.quantity } : null;
}
