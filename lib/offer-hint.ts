// Bag prompt for Buy X Get Y offers ("Add 1 more eligible item — the cheapest is free").
// Pure, unit tested. Mirrors zj-discount-engine's evaluator: every X + Y eligible units
// make one set, the CHEAPEST eligible units are discounted, at most `limitPerOrder` sets.
// Shopify (the discount function) still decides what's discounted; this only nudges.

export type ProductTarget =
  | { kind: "COLLECTIONS"; collectionIds: string[] }
  | { kind: "PRODUCTS"; productIds: string[] };

/** One entry of the engine's public offer summary (shop metafield, version 1). */
export type PublicOffer = {
  type: "BUY_X_GET_Y";
  title: string;
  startsAt: string;
  endsAt: string | null;
  buyQuantity: number;
  getQuantity: number;
  /** 100 = free. */
  percent: number;
  limitPerOrder: number;
  target: ProductTarget;
};

export type HintLine = {
  productId: string;
  /** Needed only for COLLECTIONS targets. */
  collectionIds: string[];
  variantId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  /** Most units of this variant the shopper can have (stock, line cap). */
  maxQuantity: number;
};

export type OfferHint = {
  title: string;
  message: string;
  /** One-click add of the cheapest eligible item, which then becomes the discounted one. */
  add: { variantId: string; title: string } | null;
};

const isInt = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
const isIdList = (v: unknown) => Array.isArray(v) && v.every((id) => typeof id === "string" && id.startsWith("gid://shopify/"));

/** Validates the metafield JSON; anything malformed is dropped (it only drives a hint). */
export function parseOffers(raw: string | null | undefined): PublicOffer[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (data as { version?: unknown; offers?: unknown })?.offers;
  if ((data as { version?: unknown })?.version !== 1 || !Array.isArray(list)) return [];
  return list.filter((o): o is PublicOffer => {
    const t = o?.target;
    return (
      o?.type === "BUY_X_GET_Y" &&
      typeof o.title === "string" &&
      typeof o.startsAt === "string" &&
      (o.endsAt === null || typeof o.endsAt === "string") &&
      isInt(o.buyQuantity, 1, 100) &&
      isInt(o.getQuantity, 1, 100) &&
      isInt(o.limitPerOrder, 1, 100) &&
      typeof o.percent === "number" &&
      o.percent > 0 &&
      o.percent <= 100 &&
      ((t?.kind === "PRODUCTS" && isIdList(t.productIds)) || (t?.kind === "COLLECTIONS" && isIdList(t.collectionIds)))
    );
  });
}

export function isOfferLive(offer: PublicOffer, nowMs: number): boolean {
  const start = Date.parse(offer.startsAt);
  const end = offer.endsAt === null ? Infinity : Date.parse(offer.endsAt);
  return Number.isFinite(start) && start <= nowMs && nowMs < end;
}

function matches(line: HintLine, target: ProductTarget) {
  return target.kind === "PRODUCTS"
    ? target.productIds.includes(line.productId)
    : line.collectionIds.some((id) => target.collectionIds.includes(id));
}

/**
 * The first live offer the bag is close to: it has at least X units toward the next set
 * (so only the Y "get" units are missing) and hasn't reached the per-order limit.
 */
export function offerHint(offers: PublicOffer[], lines: HintLine[], nowMs: number): OfferHint | null {
  for (const offer of offers) {
    if (!isOfferLive(offer, nowMs)) continue;
    const eligible = lines.filter((l) => l.quantity > 0 && matches(l, offer.target));
    const units = eligible.reduce((sum, l) => sum + l.quantity, 0);
    const setSize = offer.buyQuantity + offer.getQuantity;
    if (Math.floor(units / setSize) >= offer.limitPerOrder) continue;
    const toward = units % setSize;
    if (toward < offer.buyQuantity) continue;
    const need = setSize - toward;

    const reward = offer.percent >= 100 ? "free" : `${offer.percent}% off`;
    const cheapest = offer.getQuantity === 1 ? `the cheapest one is ${reward}` : `the cheapest ${offer.getQuantity} are ${reward}`;
    const message = `Add ${need} more eligible item${need === 1 ? "" : "s"} — ${cheapest}.`;

    // Cheapest eligible line (ties: earlier line), if one more unit is allowed. Adding it
    // completes the set only when one unit is missing.
    let add: OfferHint["add"] = null;
    if (need === 1) {
      const pick = [...eligible].sort((a, b) => a.unitPrice - b.unitPrice)[0];
      if (pick && pick.quantity < pick.maxQuantity) add = { variantId: pick.variantId, title: pick.title };
    }
    return { title: offer.title, message, add };
  }
  return null;
}
