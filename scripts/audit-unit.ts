import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isSafeShopifyCheckoutUrl } from "../lib/checkout-url";
import { formatMoney } from "../lib/money";
import { safeReturnTo } from "../lib/favourites";
import { createRateLimiter, isSameOrigin } from "../lib/rate-limit";
import { verifyShopifyWebhook } from "../lib/shopify-webhook";
import { mapProductNode, salePercentOff } from "../lib/products";
import type { Cart, CartLine } from "../lib/cart";
import { applyPendingEdits } from "../lib/cart-edits";
import { isSoldOutAdd, SOLD_OUT_MESSAGE, toNotices } from "../lib/cart-notices";
import {
  isBackorder,
  lineStockIssue,
  lowStockCount,
  MAX_LINE_QUANTITY,
  maxPurchasable,
} from "../lib/stock";

const STORE = "zj-store-eer28nlk.myshopify.com";
const CUSTOM = "shop.example.com";

function testCheckoutUrl() {
  assert.equal(
    isSafeShopifyCheckoutUrl(
      `https://${STORE}/cart/c/abc123`,
      STORE,
    ),
    true,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl("https://checkout.shopify.com/c/abc", STORE),
    true,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl(`https://${CUSTOM}/cart/c/x`, CUSTOM),
    true,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl(`https://${CUSTOM}/cart/c/x`, [STORE, CUSTOM]),
    true,
  );

  assert.equal(
    isSafeShopifyCheckoutUrl(`http://${STORE}/cart/c/x`, STORE),
    false,
  );
  assert.equal(isSafeShopifyCheckoutUrl("javascript:alert(1)", STORE), false);
  assert.equal(isSafeShopifyCheckoutUrl("", STORE), false);
  assert.equal(isSafeShopifyCheckoutUrl("not a url", STORE), false);
  assert.equal(
    isSafeShopifyCheckoutUrl(`https://user:pass@${STORE}/cart/c/x`, STORE),
    false,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl("https://evil.example/cart/c/x", STORE),
    false,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl(
      "https://evil.myshopify.com.attacker.com/cart/c/x",
      STORE,
    ),
    false,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl("https://notmyshopify.com/cart/c/x", STORE),
    false,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl(
      "https://other-shop.myshopify.com/cart/c/x",
      STORE,
    ),
    false,
  );
  assert.equal(
    isSafeShopifyCheckoutUrl(`https://${STORE}/cart/c/x`),
    false,
  );
}

function testMoney() {
  assert.match(formatMoney("19.99", "USD"), /USD/);
  assert.match(formatMoney("19.99", "USD"), /19\.99|19,99/);
  assert.equal(formatMoney("nope", "USD"), "nope");
  assert.equal(formatMoney("10", ""), "10");
  assert.equal(formatMoney("12.5", "NOTREAL"), "NOTREAL 12.5");
}

function testSalePercent() {
  assert.equal(
    salePercentOff(
      { amount: "80", currencyCode: "USD" },
      { amount: "100", currencyCode: "USD" },
    ),
    20,
  );
  assert.equal(
    salePercentOff(
      { amount: "100", currencyCode: "USD" },
      { amount: "80", currencyCode: "USD" },
    ),
    null,
  );
}

function productNode(
  variants: { price: string; compareAt: string | null }[],
) {
  const usd = (amount: string) => ({ amount, currencyCode: "USD" });
  const min = Math.min(...variants.map((v) => Number(v.price))).toFixed(2);
  return {
    id: "p",
    title: "P",
    handle: "p",
    description: "",
    productType: "",
    vendor: "",
    tags: [],
    availableForSale: true,
    featuredImage: null,
    images: { edges: [] },
    priceRange: { minVariantPrice: usd(min) },
    variants: {
      edges: variants.map((v, i) => ({
        node: {
          id: `v${i}`,
          title: `V${i}`,
          availableForSale: true,
          price: usd(v.price),
          compareAtPrice: v.compareAt ? usd(v.compareAt) : null,
          selectedOptions: [],
        },
      })),
    },
  } as Parameters<typeof mapProductNode>[0];
}

function testCompareAtComesFromCheapestVariant() {
  // Only the pricier variant is on sale: the card's $50 must not show "was $90".
  assert.equal(
    mapProductNode(
      productNode([
        { price: "50.00", compareAt: null },
        { price: "80.00", compareAt: "90.00" },
      ]),
    ).compareAtPrice,
    null,
  );
  // The cheapest variant is on sale: its own compare-at price is used.
  assert.deepEqual(
    mapProductNode(
      productNode([
        { price: "50.00", compareAt: "70.00" },
        { price: "80.00", compareAt: "90.00" },
      ]),
    ).compareAtPrice,
    { amount: "70.00", currencyCode: "USD" },
  );
}

function testSafeReturnTo() {
  // Each of these resolves to another origin in a browser.
  for (const offsite of [
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "https://evil.com",
  ]) {
    assert.equal(safeReturnTo(offsite), "/account", JSON.stringify(offsite));
  }
  assert.equal(safeReturnTo("/products/x?y=1#top"), "/products/x?y=1#top");
  assert.equal(safeReturnTo("/account/login?x=1"), "/account");
  assert.equal(safeReturnTo(null), "/account");
}

function testRateLimiter() {
  const check = createRateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(check("ip", 3, 60_000, t0).allowed, true);
  }
  const blocked = check("ip", 3, 60_000, t0 + 1_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 59);
  // Other keys are counted separately.
  assert.equal(check("other-ip", 3, 60_000, t0).allowed, true);
  // A new window starts once the old one expires.
  assert.equal(check("ip", 3, 60_000, t0 + 60_000).allowed, true);

  // Memory stays bounded: a full table evicts rather than growing.
  const small = createRateLimiter({ maxKeys: 2 });
  small("a", 1, 60_000, t0);
  small("b", 1, 60_000, t0);
  small("c", 1, 60_000, t0);
  assert.equal(small("a", 1, 60_000, t0).allowed, true, "evicted key restarts");
}

function testSameOrigin() {
  const site = "https://shop.example";
  assert.equal(isSameOrigin("https://shop.example", site), true);
  assert.equal(isSameOrigin("https://evil.example", site), false);
  assert.equal(isSameOrigin("http://shop.example", site), false);
  assert.equal(isSameOrigin(null, site), false);
  assert.equal(isSameOrigin("not a url", site), false);
}

testCheckoutUrl();
testMoney();
testSalePercent();
testCompareAtComesFromCheapestVariant();
testSafeReturnTo();
function testShopifyWebhookSignature() {
  const secret = "test-secret";
  const body = '{"id":1,"title":"Shoe"}';
  const sign = (payload: string, key = secret) =>
    createHmac("sha256", key).update(payload, "utf8").digest("base64");

  assert.equal(verifyShopifyWebhook(body, sign(body), secret), true);
  assert.equal(
    verifyShopifyWebhook('{"id":1,"title":"Hacked"}', sign(body), secret),
    false,
    "tampered body",
  );
  assert.equal(verifyShopifyWebhook(body, sign(body, "wrong"), secret), false);
  assert.equal(verifyShopifyWebhook(body, null, secret), false);
  assert.equal(verifyShopifyWebhook(body, "c2hvcnQ=", secret), false, "short");
  assert.equal(verifyShopifyWebhook(body, sign(body), ""), false, "no secret");
}

// --- Cart fixtures shaped like lib/cart.ts flattenCart output ---------------

const usd = (amount: string) => ({ amount, currencyCode: "USD" });

function cartLine(
  id: string,
  quantity: number,
  unitPrice: string,
  options: { total?: string; discounted?: boolean; variantId?: string } = {},
): CartLine {
  const subtotal = (Number(unitPrice) * quantity).toFixed(2);
  return {
    id,
    quantity,
    merchandise: {
      id: options.variantId ?? `variant-${id}`,
      title: "Default Title",
      availableForSale: true,
      currentlyNotInStock: false,
      quantityAvailable: 20,
      image: null,
      product: { title: `Product ${id}`, handle: `product-${id}` },
    },
    discountAllocations: options.discounted
      ? [
          {
            discountedAmount: usd("2.00"),
            sourceDiscountApplication: { code: "SAVE" },
          },
        ]
      : [],
    cost: {
      amountPerQuantity: usd(unitPrice),
      compareAtAmountPerQuantity: null,
      subtotalAmount: usd(subtotal),
      totalAmount: usd(options.total ?? subtotal),
    },
  };
}

function cartOf(lines: CartLine[], subtotal: string, total: string): Cart {
  return {
    id: "gid://shopify/Cart/1",
    checkoutUrl: "https://checkout.shopify.com/c/1",
    updatedAt: "2026-10-29T10:00:00Z",
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    discountCodes: [],
    discountApplications: [],
    cost: {
      subtotalAmount: usd(subtotal),
      totalAmount: usd(total),
      checkoutChargeAmount: usd(total),
    },
    lines,
  };
}

function testApplyPendingEdits() {
  // A: 1 × $20. B: 2 × $10 with a $2 line discount (total $18).
  const cart = cartOf(
    [cartLine("A", 1, "20.00"), cartLine("B", 2, "10.00", { total: "18.00", discounted: true })],
    "40.00",
    "38.00",
  );

  assert.equal(applyPendingEdits(cart, {}, []), cart, "no edits → same object");

  const raised = applyPendingEdits(cart, { A: 3 }, []);
  const a = raised.lines.find((line) => line.id === "A")!;
  assert.equal(a.quantity, 3);
  assert.equal(Number(a.cost.subtotalAmount.amount), 60);
  assert.equal(Number(a.cost.totalAmount.amount), 60);
  assert.equal(Number(raised.cost.subtotalAmount.amount), 80);
  // Server total shifted by the subtotal change: 38 + (80 − 40).
  assert.equal(Number(raised.cost.totalAmount.amount), 78);
  assert.equal(raised.totalQuantity, 5);

  // A discounted line keeps Shopify's total until it recalculates.
  const discounted = applyPendingEdits(cart, { B: 3 }, []);
  const b = discounted.lines.find((line) => line.id === "B")!;
  assert.equal(Number(b.cost.subtotalAmount.amount), 30);
  assert.equal(b.cost.totalAmount.amount, "18.00");

  const removed = applyPendingEdits(cart, {}, ["A"]);
  assert.deepEqual(removed.lines.map((line) => line.id), ["B"]);
  assert.equal(Number(removed.cost.subtotalAmount.amount), 20);
  assert.equal(removed.totalQuantity, 2);
}

function testCartNotices() {
  // Shape captured from Shopify: the warning target is the cart line id.
  const lineId = "gid://shopify/CartLine/abc?cart=xyz";
  const capped = cartOf(
    [cartLine(lineId, 20, "25.00", { variantId: "gid://shopify/ProductVariant/1" })],
    "500.00",
    "500.00",
  );

  assert.deepEqual(
    toNotices({
      cart: capped,
      warnings: [
        {
          code: "MERCHANDISE_NOT_ENOUGH_STOCK",
          message: "Only 20 items were added to your cart due to availability.",
          target: lineId,
        },
      ],
    }),
    [{ lineId, message: "Only 20 available. We've updated your bag." }],
  );
  assert.equal(
    toNotices({
      cart: capped,
      warnings: [{ code: "MERCHANDISE_OUT_OF_STOCK", message: "x", target: lineId }],
    })[0].message,
    SOLD_OUT_MESSAGE,
  );
  assert.equal(
    toNotices({
      cart: capped,
      warnings: [{ code: "SOMETHING_NEW", message: "Shopify says hi", target: lineId }],
    })[0].message,
    "Shopify says hi",
    "unknown codes pass Shopify's message through",
  );

  const soldOutWarning = {
    code: "MERCHANDISE_OUT_OF_STOCK",
    message: "x",
    target: "gid://shopify/ProductVariant/2",
  };
  const empty = cartOf([], "0.00", "0.00");
  assert.equal(
    isSoldOutAdd({ cart: empty, warnings: [soldOutWarning] }, "gid://shopify/ProductVariant/2"),
    true,
    "sold out and not added → failure",
  );
  assert.equal(
    isSoldOutAdd({ cart: capped, warnings: [soldOutWarning] }, "gid://shopify/ProductVariant/1"),
    false,
    "the variant made it into the cart",
  );
  assert.equal(isSoldOutAdd({ cart: empty, warnings: [] }, "v"), false);
}

function testStockRules() {
  const tracked = (quantityAvailable: number | null) => ({
    availableForSale: true,
    currentlyNotInStock: false,
    quantityAvailable,
  });
  const backorder = { availableForSale: true, currentlyNotInStock: true, quantityAvailable: -3 };
  const soldOut = { availableForSale: false, currentlyNotInStock: false, quantityAvailable: 0 };

  assert.equal(maxPurchasable(soldOut), 0);
  assert.equal(maxPurchasable(tracked(20)), 20);
  assert.equal(maxPurchasable(tracked(150)), MAX_LINE_QUANTITY, "capped at 99");
  assert.equal(maxPurchasable(tracked(0)), MAX_LINE_QUANTITY, "untracked");
  assert.equal(maxPurchasable(tracked(null)), MAX_LINE_QUANTITY, "not fetched");
  assert.equal(maxPurchasable(backorder), MAX_LINE_QUANTITY);
  assert.equal(isBackorder(backorder), true);

  assert.equal(lowStockCount(tracked(5)), 5);
  assert.equal(lowStockCount(tracked(6)), null);
  assert.equal(lowStockCount(backorder), null);

  assert.equal(lineStockIssue(soldOut, 1), "Sold out. Remove it to check out.");
  assert.equal(
    lineStockIssue(tracked(3), 5),
    "Only 3 available. Lower the quantity to check out.",
  );
  assert.equal(lineStockIssue(tracked(3), 3), null);
  assert.equal(lineStockIssue(backorder, 50), null);
}

testRateLimiter();
testSameOrigin();
testShopifyWebhookSignature();
testApplyPendingEdits();
testCartNotices();
testStockRules();
console.log("audit-unit: all assertions passed");
