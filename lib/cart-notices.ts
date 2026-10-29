import type { CartMutationResult } from "./cart";

// Pure helpers for app/cart/actions.ts ("use server" files may only export
// async functions), kept here so they can be unit-tested.

/** Something the shopper should know about a line, e.g. stock capped it. */
export type CartLineNotice = { lineId: string; message: string };

export const SOLD_OUT_MESSAGE = "Sorry, this item just sold out.";

/** Turns Shopify cart `warnings` into per-line messages for the shopper. */
export function toNotices({
  cart,
  warnings,
}: CartMutationResult): CartLineNotice[] {
  return warnings.map((warning) => {
    const line = cart.lines.find((item) => item.id === warning.target);

    if (warning.code === "MERCHANDISE_NOT_ENOUGH_STOCK" && line) {
      return {
        lineId: warning.target,
        message: `Only ${line.quantity} available. We've updated your bag.`,
      };
    }
    if (warning.code === "MERCHANDISE_OUT_OF_STOCK") {
      return { lineId: warning.target, message: SOLD_OUT_MESSAGE };
    }
    return { lineId: warning.target, message: warning.message };
  });
}

/** Shopify accepts an add of sold-out stock but leaves it out of the cart. */
export function isSoldOutAdd(
  result: CartMutationResult,
  variantId: string,
): boolean {
  const added = result.cart.lines.some(
    (line) => line.merchandise.id === variantId,
  );
  const soldOut = result.warnings.some(
    (warning) => warning.code === "MERCHANDISE_OUT_OF_STOCK",
  );
  return !added && soldOut;
}
