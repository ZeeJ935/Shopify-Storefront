import type { Cart } from "./cart";
import { multiplyMoney, sumMoney } from "./money";

/**
 * The cart as the shopper should see it: the last server-confirmed cart with
 * pending quantity edits and removals applied. Pure, so it's unit-tested.
 */
export function applyPendingEdits(
  cart: Cart,
  overrides: Record<string, number>,
  removedIds: string[],
): Cart {
  if (Object.keys(overrides).length === 0 && removedIds.length === 0) {
    return cart;
  }

  const lines = cart.lines
    .filter((line) => !removedIds.includes(line.id))
    .map((line) => {
      const quantity = overrides[line.id];
      if (quantity === undefined || quantity === line.quantity) {
        return line;
      }

      const subtotalAmount = multiplyMoney(
        line.cost.amountPerQuantity,
        quantity,
      );
      // Discounted totals are only known once Shopify recalculates.
      const totalAmount =
        line.discountAllocations.length > 0
          ? line.cost.totalAmount
          : subtotalAmount;

      return {
        ...line,
        quantity,
        cost: { ...line.cost, subtotalAmount, totalAmount },
      };
    });

  const currency = cart.cost.subtotalAmount.currencyCode;
  const subtotalAmount = sumMoney(
    lines.map((line) => line.cost.subtotalAmount),
    currency,
  );
  // Shift the server total by the subtotal change; discounts settle on confirm.
  const totalAmount = sumMoney(
    [
      cart.cost.totalAmount,
      subtotalAmount,
      multiplyMoney(cart.cost.subtotalAmount, -1),
    ],
    currency,
  );

  return {
    ...cart,
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    cost: { ...cart.cost, subtotalAmount, totalAmount },
  };
}
