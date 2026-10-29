import assert from "node:assert/strict";
import { isSafeShopifyCheckoutUrl } from "../lib/checkout-url";
import { formatMoney } from "../lib/money";
import { safeReturnTo } from "../lib/favourites";
import { createRateLimiter, isSameOrigin } from "../lib/rate-limit";
import { mapProductNode, salePercentOff } from "../lib/products";

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
testRateLimiter();
testSameOrigin();
console.log("audit-unit: all assertions passed");
