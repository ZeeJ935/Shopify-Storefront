import assert from "node:assert/strict";
import { isSafeShopifyCheckoutUrl } from "../lib/checkout-url";
import { formatMoney } from "../lib/money";
import { salePercentOff } from "../lib/products";

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

testCheckoutUrl();
testMoney();
testSalePercent();
console.log("audit-unit: all assertions passed");
