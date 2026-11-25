import { sumMoney, type Money } from "./money";

/**
 * Once Shopify knows the delivery address (a signed-in shopper's cart), it picks a
 * delivery option and includes its estimated cost in the cart total. The bag shows it
 * as its own line so subtotal − discounts + shipping adds up to the total.
 */
export type EstimatedShipping = { title: string | null; cost: Money };

type DeliveryGroups = {
  nodes: { selectedDeliveryOption: { title: string | null; estimatedCost: Money } | null }[];
};

/** Null when no delivery option is selected (no address yet). Pure, unit tested. */
export function estimatedShipping(groups: DeliveryGroups | null | undefined): EstimatedShipping | null {
  const selected = (groups?.nodes ?? []).flatMap((g) => (g.selectedDeliveryOption ? [g.selectedDeliveryOption] : []));
  if (selected.length === 0) return null;
  const cost = sumMoney(
    selected.map((o) => o.estimatedCost),
    selected[0].estimatedCost.currencyCode,
  );
  // One option: show its name ("Standard"); several shipments: just "Shipping".
  return { title: selected.length === 1 ? selected[0].title : null, cost };
}
