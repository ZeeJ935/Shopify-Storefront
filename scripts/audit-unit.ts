import assert from "node:assert/strict";
import { isSafeShopifyCheckoutUrl } from "../lib/checkout-url";
import { formatMoney } from "../lib/money";
import { safeReturnTo } from "../lib/favourites";
import { createRateLimiter, isSameOrigin } from "../lib/rate-limit";
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
import {
  customerIdFromClaims,
  customerIdFromIdToken,
  decodeJwtPayload,
} from "../lib/customer-account/id-token";
import { parseSessionPayload, seal, unseal } from "../lib/customer-account/seal";
import { isServiceTokenValid } from "../lib/service-token";
import fs from "node:fs";
import path from "node:path";
import { withCatalogFallback } from "../lib/catalog-fallback";
import { PARITY_FILE, parityJson } from "./catalog-parity";
import { NextRequest } from "next/server";
import { clientIp } from "../lib/client-ip";
import { rateLimitResponse } from "../lib/proxy-rate-limit";
import { createSharedRateLimiter, type MakeLimiter } from "../lib/shared-rate-limit";
import {
  describeFavouritesError,
  loadFavourites,
  mergeForLogin,
  pickFavouritesStore,
  type FavouritesBackend,
} from "../lib/favourites-store";

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

// ---- Customer identity in the session ----

const CLIENT_ID = "shp_test-client";
const ISSUER = "https://shopify.com/authentication/12345";
const SECRET = "x".repeat(48);

function fakeJwt(claims: Record<string, unknown>) {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
}

function testCustomerIdFromIdToken() {
  const expected = { clientId: CLIENT_ID, issuer: ISSUER };
  const good = { iss: ISSUER, aud: CLIENT_ID, sub: "10000000000001" };

  assert.equal(customerIdFromIdToken(fakeJwt(good), expected), "10000000000001");
  // Trailing slash on either side and aud as an array are both fine.
  assert.equal(
    customerIdFromIdToken(fakeJwt({ ...good, iss: `${ISSUER}/` }), expected),
    "10000000000001",
  );
  assert.equal(
    customerIdFromIdToken(fakeJwt({ ...good, aud: ["other", CLIENT_ID] }), expected),
    "10000000000001",
  );

  assert.equal(customerIdFromIdToken(fakeJwt({ ...good, aud: "someone-else" }), expected), null);
  assert.equal(customerIdFromIdToken(fakeJwt({ ...good, iss: "https://evil.example" }), expected), null);
  assert.equal(customerIdFromIdToken(fakeJwt({ ...good, sub: "" }), expected), null);
  assert.equal(customerIdFromIdToken(fakeJwt({ iss: ISSUER, aud: CLIENT_ID }), expected), null);
  assert.equal(customerIdFromIdToken("not-a-jwt", expected), null);
  assert.equal(customerIdFromIdToken("a.%%%.c", expected), null);
  assert.equal(customerIdFromIdToken(undefined, expected), null);

  assert.equal(decodeJwtPayload("a.b"), null);
  assert.equal(customerIdFromClaims({ sub: " 42 " }), "42");
  assert.equal(customerIdFromClaims({ sub: 42 }), null);
  assert.equal(customerIdFromClaims(null), null);
}

function testSessionSealAndParse() {
  const payload = {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: 1_900_000_000_000,
    customerId: "10000000000001",
  };

  // Round trip keeps the customer ID.
  const sealed = seal(payload, SECRET);
  assert.deepEqual(parseSessionPayload(unseal(sealed, SECRET)), {
    ...payload,
    storefrontToken: undefined,
  });

  // Tampered, truncated or wrong-secret cookies are rejected, not thrown.
  const raw = Buffer.from(sealed, "base64url");
  raw[raw.length - 1] ^= 1;
  assert.equal(unseal(raw.toString("base64url"), SECRET), null);
  assert.equal(unseal("short", SECRET), null);
  assert.equal(unseal(sealed, "y".repeat(48)), null);

  // Sessions from before the ID was stored still parse, with no customerId.
  const legacy = parseSessionPayload({ accessToken: "at", refreshToken: "rt", expiresAt: 1 });
  assert.ok(legacy);
  assert.equal(legacy.customerId, undefined);
  assert.equal(parseSessionPayload({ ...payload, customerId: "" })?.customerId, undefined);

  // Missing tokens or a bad expiry make it no session at all.
  assert.equal(parseSessionPayload({ refreshToken: "rt", expiresAt: 1 }), null);
  assert.equal(parseSessionPayload({ accessToken: "at", refreshToken: "rt", expiresAt: "soon" }), null);
  assert.equal(parseSessionPayload(null), null);
}

// ---- Favourites: Postgres store, one-time metafield import, login merge ----

function fakeFavouritesBackend(start: { ids: string[]; imported: boolean }, { down = false } = {}) {
  const state = { ...start, ids: [...start.ids] };
  const calls = { get: 0, importOnce: [] as string[][] };
  const backend: FavouritesBackend = {
    async get() {
      calls.get++;
      if (down) throw new Error("Backend request failed: 503 /v1/favourites");
      return { ...state, ids: [...state.ids] };
    },
    async importOnce(ids) {
      calls.importOnce.push(ids);
      if (down) throw new Error("down");
      if (state.imported) return { ...state, imported: false };
      state.ids = [...new Set([...state.ids, ...ids])];
      state.imported = true;
      return { ...state, imported: true };
    },
  };
  return { backend, calls, state };
}

async function testLoadFavourites() {
  let metafieldReads = 0;
  const metafield = (ids: string[]) => async () => {
    metafieldReads++;
    return ids;
  };

  // Already imported: Postgres only, the metafield is not read.
  {
    const f = fakeFavouritesBackend({ ids: ["p1", "p2"], imported: true });
    metafieldReads = 0;
    assert.deepEqual(await loadFavourites({ backend: f.backend, readMetafield: metafield(["old"]) }), {
      ids: ["p1", "p2"],
      loaded: true,
    });
    assert.equal(metafieldReads, 0);
    assert.equal(f.calls.importOnce.length, 0);
  }

  // First load: read the metafield once and import it (de-duplicated, capped at 200).
  {
    const f = fakeFavouritesBackend({ ids: [], imported: false });
    const big = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const result = await loadFavourites({ backend: f.backend, readMetafield: metafield(["p0", ...big]) });
    assert.equal(result.loaded, true);
    assert.equal(result.ids.length, 200);
    assert.equal(f.calls.importOnce.length, 1);
    assert.equal(f.calls.importOnce[0].length, 200);
    // Next load comes straight from Postgres.
    metafieldReads = 0;
    await loadFavourites({ backend: f.backend, readMetafield: metafield(["x"]) });
    assert.equal(metafieldReads, 0);
  }

  // Empty metafield: imports [] and is marked imported, so it is never re-imported.
  {
    const f = fakeFavouritesBackend({ ids: [], imported: false });
    assert.deepEqual(await loadFavourites({ backend: f.backend, readMetafield: metafield([]) }), {
      ids: [],
      loaded: true,
    });
    assert.equal(f.state.imported, true);
  }

  // Backend down: not loaded, nothing imported, nothing read from Shopify.
  {
    const f = fakeFavouritesBackend({ ids: ["p1"], imported: true }, { down: true });
    metafieldReads = 0;
    assert.deepEqual(await loadFavourites({ backend: f.backend, readMetafield: metafield(["old"]) }), {
      ids: [],
      loaded: false,
    });
    assert.equal(f.calls.importOnce.length, 0);
    assert.equal(metafieldReads, 0);
  }

  // Shopify read fails during the first load: not loaded, and no (empty) import is written.
  {
    const f = fakeFavouritesBackend({ ids: [], imported: false });
    const result = await loadFavourites({
      backend: f.backend,
      readMetafield: async () => {
        throw new Error("Customer Account API unavailable");
      },
    });
    assert.deepEqual(result, { ids: [], loaded: false });
    assert.equal(f.calls.importOnce.length, 0);
    assert.equal(f.state.imported, false);
  }
}

function testMergeForLogin() {
  // Saved favourites keep their order; guest ones are appended; duplicates removed.
  assert.deepEqual(mergeForLogin(["a", "b"], ["b", "c", "a", "d"]), ["a", "b", "c", "d"]);
  assert.deepEqual(mergeForLogin([], ["x", "x", ""]), ["x"]);
  assert.deepEqual(mergeForLogin(["a"], "not-an-array"), ["a"]);
  // Capped at 200, saved ones win.
  const saved = Array.from({ length: 199 }, (_, i) => `s${i}`);
  const merged = mergeForLogin(saved, ["g1", "g2"]);
  assert.equal(merged.length, 200);
  assert.equal(merged[199], "g1");
}

function testPickFavouritesStore() {
  assert.equal(pickFavouritesStore({}), "metafield");
  assert.equal(pickFavouritesStore({ BACKEND_URL: "http://x" }), "metafield");
  assert.equal(pickFavouritesStore({ BACKEND_SERVICE_TOKEN: "t" }), "metafield");
  assert.equal(pickFavouritesStore({ BACKEND_URL: " ", BACKEND_SERVICE_TOKEN: "t" }), "metafield");
  assert.equal(pickFavouritesStore({ BACKEND_URL: "http://x", BACKEND_SERVICE_TOKEN: "t" }), "postgres");
}

async function testFavouritesErrorReporting() {
  const seen: string[] = [];
  const onError = (stage: string, error: unknown) => seen.push(`${stage}: ${describeFavouritesError(error)}`);
  const backendError = Object.assign(new Error("Backend request failed: 500 /v1/favourites"), {
    name: "BackendError",
    status: 500,
    path: "/v1/favourites",
  });

  // Backend read fails → reported as backend-read with status and path.
  await loadFavourites({
    backend: { get: async () => { throw backendError; }, importOnce: async () => ({ ids: [], imported: true }) },
    readMetafield: async () => [],
    onError,
  });
  // Metafield read fails during the first load.
  await loadFavourites({
    backend: { get: async () => ({ ids: [], imported: false }), importOnce: async () => ({ ids: [], imported: true }) },
    readMetafield: async () => { throw new TypeError("fetch failed"); },
    onError,
  });
  // Import fails.
  await loadFavourites({
    backend: { get: async () => ({ ids: [], imported: false }), importOnce: async () => { throw backendError; } },
    readMetafield: async () => ["p1"],
    onError,
  });
  assert.deepEqual(seen, [
    "backend-read: backend returned 500 for /v1/favourites",
    "metafield-read: TypeError: fetch failed",
    "import: backend returned 500 for /v1/favourites",
  ]);

  // Success reports nothing.
  seen.length = 0;
  await loadFavourites({
    backend: { get: async () => ({ ids: ["p1"], imported: true }), importOnce: async () => ({ ids: [], imported: true }) },
    readMetafield: async () => [],
    onError,
  });
  assert.equal(seen.length, 0);
  assert.equal(describeFavouritesError("x".repeat(500)).length, 200);
}

function testServiceToken() {
  const token = "s".repeat(48);
  assert.equal(isServiceTokenValid(`Bearer ${token}`, token), true);
  assert.equal(isServiceTokenValid(`Bearer ${token}x`, token), false);
  assert.equal(isServiceTokenValid(`Bearer ${token.slice(1)}`, token), false);
  assert.equal(isServiceTokenValid(token, token), false); // no "Bearer "
  assert.equal(isServiceTokenValid("Bearer ", token), false);
  assert.equal(isServiceTokenValid(null, token), false);
  assert.equal(isServiceTokenValid(`Bearer ${token}`, undefined), false); // not configured
  assert.equal(isServiceTokenValid("Bearer ", ""), false);
}

// ---- Shared rate limiting (Upstash) ----

function testClientIp() {
  const h = (init: Record<string, string>) => new Headers(init);
  const vercel = { VERCEL: "1" };
  assert.equal(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }), vercel), "203.0.113.7");
  assert.equal(clientIp(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), vercel), "198.51.100.1");
  assert.equal(clientIp(h({}), vercel), "unknown");
  // Off Vercel nothing is trusted: a client-sent header can't pick its own bucket.
  assert.equal(clientIp(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }), {}), "local");
}

/** A fake Upstash limiter: counts per key, blocks past `limit`, resets 30 s from "now". */
function fakeUpstash(now: () => number, { fail = false, timeout = false } = {}) {
  const made: string[] = [];
  const counts = new Map<string, number>();
  const make: MakeLimiter = (bucket, limit) => {
    made.push(`${bucket}:${limit}`);
    return {
      async limit(id) {
        if (fail) throw new Error("fetch failed: ECONNREFUSED");
        if (timeout) return { success: true, reset: 0, reason: "timeout" };
        const n = (counts.get(`${bucket}:${id}`) ?? 0) + 1;
        counts.set(`${bucket}:${id}`, n);
        return { success: n <= limit, reset: now() + 30_000 };
      },
    };
  };
  return { make, made };
}

const UPSTASH_ENV = { UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "token" };

async function testSharedRateLimit() {
  const now = () => 1_000_000;

  // Redis mode: over the limit → blocked with Retry-After from the window reset.
  {
    const fake = fakeUpstash(now);
    const limiter = createSharedRateLimiter({ env: UPSTASH_ENV, windowMs: 60_000, makeLimiter: fake.make, now });
    assert.equal(limiter.mode, "redis");
    assert.deepEqual(await limiter.check("search", "1.1.1.1", 2), { allowed: true, retryAfterSeconds: 0 });
    assert.deepEqual(await limiter.check("search", "1.1.1.1", 2), { allowed: true, retryAfterSeconds: 0 });
    assert.deepEqual(await limiter.check("search", "1.1.1.1", 2), { allowed: false, retryAfterSeconds: 30 });
    // Other clients and other buckets are separate; one limiter per bucket is reused.
    assert.equal((await limiter.check("search", "2.2.2.2", 2)).allowed, true);
    assert.equal((await limiter.check("action", "1.1.1.1", 2)).allowed, true);
    assert.deepEqual(fake.made, ["search:2", "action:2"]);
  }

  // Redis error: fail open, and log once (not on every request).
  {
    const logs: string[] = [];
    const fake = fakeUpstash(now, { fail: true });
    const limiter = createSharedRateLimiter({ env: UPSTASH_ENV, windowMs: 60_000, makeLimiter: fake.make, now, log: (m) => logs.push(m) });
    for (let i = 0; i < 5; i++) assert.equal((await limiter.check("search", "1.1.1.1", 1)).allowed, true);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /Redis unavailable, allowing requests: fetch failed/);
  }

  // Redis too slow (Upstash's own timeout): also fail open and logged.
  {
    const logs: string[] = [];
    const fake = fakeUpstash(now, { timeout: true });
    const limiter = createSharedRateLimiter({ env: UPSTASH_ENV, windowMs: 60_000, makeLimiter: fake.make, now, log: (m) => logs.push(m) });
    assert.equal((await limiter.check("search", "1.1.1.1", 1)).allowed, true);
    assert.match(logs[0], /timed out/);
  }

  // No Upstash env (local dev): the in-memory limiter is used and still limits.
  {
    const fake = fakeUpstash(now);
    for (const env of [{}, { UPSTASH_REDIS_REST_URL: "https://x" }, { UPSTASH_REDIS_REST_TOKEN: "t" }]) {
      const limiter = createSharedRateLimiter({ env, windowMs: 60_000, makeLimiter: fake.make, now });
      assert.equal(limiter.mode, "memory");
      assert.equal((await limiter.check("search", "local", 2)).allowed, true);
      assert.equal((await limiter.check("search", "local", 2)).allowed, true);
      assert.deepEqual(await limiter.check("search", "local", 2), { allowed: false, retryAfterSeconds: 60 });
    }
    assert.deepEqual(fake.made, []); // Redis never touched
  }

  // Proxy level: the 61st search request in a minute gets 429 + Retry-After.
  {
    const fake = fakeUpstash(now);
    const limiter = createSharedRateLimiter({ env: UPSTASH_ENV, windowMs: 60_000, makeLimiter: fake.make, now });
    const search = () =>
      new NextRequest("https://shop.example/api/predictive-search?q=shoe", { headers: { "x-vercel-forwarded-for": "203.0.113.9" } });
    for (let i = 0; i < 60; i++) assert.equal(await rateLimitResponse(search(), limiter.check, { VERCEL: "1" }), null);
    const blocked = await rateLimitResponse(search(), limiter.check, { VERCEL: "1" });
    assert.ok(blocked);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("Retry-After"), "30");
    assert.deepEqual(await blocked.json(), { error: "Too many requests" });

    // Unlimited routes are never checked; server actions use the 120/min bucket.
    assert.equal(await rateLimitResponse(new NextRequest("https://shop.example/products/x"), limiter.check, {}), null);
    const action = new NextRequest("https://shop.example/cart", { method: "POST", headers: { "next-action": "abc" } });
    assert.equal(await rateLimitResponse(action, limiter.check, {}), null);
    assert.ok(fake.made.includes("action:120"));
  }
}

// ---- Catalog from the backend, with the snapshot as fallback ----

async function testCatalogFallback() {
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const snapshot = { products: ["from-snapshot"] };
  let backendCalls = 0;

  // Backend answers: used.
  const ok = await withCatalogFallback({
    configured: true,
    label: "catalog",
    fromBackend: async () => ({ products: ["from-backend"], empty: false }),
    fromSnapshot: async () => snapshot,
    log,
  });
  assert.equal(ok.source, "backend");
  assert.deepEqual(ok.value.products, ["from-backend"]);

  // Backend down: snapshot, and the reason is logged.
  const down = await withCatalogFallback({
    configured: true,
    label: "catalog",
    fromBackend: async () => {
      throw new Error("Backend request failed: 503 /v1/catalog");
    },
    fromSnapshot: async () => snapshot,
    log,
  });
  assert.equal(down.source, "snapshot");
  assert.deepEqual(down.value, snapshot);
  assert.match(logs.at(-1) ?? "", /catalog fallback: Backend request failed: 503/);

  // Backend reachable but nothing synced yet: snapshot, never an empty catalog.
  const empty = await withCatalogFallback({
    configured: true,
    label: "overview",
    fromBackend: async () => ({ products: [], empty: true }),
    fromSnapshot: async () => snapshot,
    log,
  });
  assert.equal(empty.source, "snapshot");
  assert.match(logs.at(-1) ?? "", /overview fallback: backend catalog is empty/);

  // Not configured (local dev, or before the switch): snapshot, backend never called.
  const off = await withCatalogFallback({
    configured: false,
    label: "catalog",
    fromBackend: async () => {
      backendCalls++;
      return { products: [], empty: false };
    },
    fromSnapshot: async () => snapshot,
    log,
  });
  assert.equal(off.source, "snapshot");
  assert.equal(backendCalls, 0);
}

function testCatalogParityAndSharedCode() {
  // The backend's parity fixture must match what the old logic produces today.
  assert.equal(
    fs.readFileSync(PARITY_FILE, "utf8"),
    parityJson(),
    "backend/test/fixtures/catalog-parity.json is stale: run npx tsx scripts/catalog-parity.ts --write",
  );
  // The backend's copy of the shared catalog code must be identical.
  const appDir = path.join(__dirname, "../lib/catalog-shared");
  const backendDir = path.join(__dirname, "../backend/src/catalog-shared");
  const files = fs.readdirSync(appDir).sort();
  assert.deepEqual(fs.readdirSync(backendDir).sort(), files);
  for (const file of files) {
    assert.equal(
      fs.readFileSync(path.join(backendDir, file), "utf8"),
      fs.readFileSync(path.join(appDir, file), "utf8"),
      `backend/src/catalog-shared/${file} differs: run npm run sync:shared in backend/`,
    );
  }
}

testRateLimiter();
testSameOrigin();
testApplyPendingEdits();
testCartNotices();
testStockRules();
testCustomerIdFromIdToken();
testSessionSealAndParse();
testMergeForLogin();
testPickFavouritesStore();
testServiceToken();
testClientIp();
testCatalogParityAndSharedCode();
testLoadFavourites()
  .then(testFavouritesErrorReporting)
  .then(testSharedRateLimit)
  .then(testCatalogFallback)
  .then(() => console.log("audit-unit: all assertions passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
