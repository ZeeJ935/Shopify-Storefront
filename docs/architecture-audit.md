# Complete Shopify Storefront Architecture & Expertise Audit

**Repository:** `zj-headless-storefront`  
**Audit date:** 2026-10-28  
**Scope:** Read-only inspection of the current codebase. No files were modified for this audit (this document is the deliverable).  
**Verification note:** Claims marked **Verified** come from source inspection. Claims marked **Inferred** are reasoned from code/config but not runtime-proven. Shopify Admin settings, live production infra, and payment completion were **not** inspected in Admin / payment processors.  
**Last updated:** 2026-10-29 — sections below are corrected for the changes listed in §0.

---

# 0. Changes since this audit (2026-10-29)

| Area | Change | Where |
|------|--------|-------|
| Cart | Shared client cart (`CartProvider`): optimistic edits, one request per burst of quantity changes, serialized write queue, no route re-render after mutations | `app/components/cart-provider.tsx`, `app/cart/actions.ts` |
| Cart | Slide-out drawer opens after “Add to cart” | `app/components/cart-drawer.tsx` |
| Cart | Actions call one Shopify mutation and return the full cart (no pre-check `getCart`, no `revalidatePath`/`refresh`) | `app/cart/actions.ts`, `lib/cart.ts` |
| Stock | `quantityAvailable` / `currentlyNotInStock` fetched; quantity capped to stock; Shopify cart `warnings` (`MERCHANDISE_NOT_ENOUGH_STOCK` / `OUT_OF_STOCK`) shown per line; checkout blocked on stock problems | `lib/stock.ts`, `lib/cart.ts` |
| Buyer identity | Cart linked to the customer on login (`storefrontCustomerAccessTokenCreate` → `cartBuyerIdentityUpdate`); logout clears the cart cookie | `lib/customer-account/oauth.ts`, `app/account/logout/route.ts` |
| Webhooks | Signed Shopify webhooks → `revalidateTag("catalog", { expire: 0 })`; all cached Storefront data tagged | `app/api/webhooks/shopify/route.ts`, `lib/shopify.ts` |
| Proxy | `proxy.ts`: per-IP rate limiting (search, catalog, Server Actions), cross-site logout rejected, account return path forwarded | `proxy.ts`, `lib/rate-limit.ts` |
| Errors | `app/error.tsx` + `app/global-error.tsx`; account actions show friendly messages; order API failures no longer shown as 404 | `app/`, `lib/customer-account/api.ts` |
| Security | `safeReturnTo` resolves the URL (blocks `/\host`, tab/newline tricks); refresh route uses it | `lib/favourites.ts` |
| Favourites | Failed load can no longer overwrite saved favourites; saves serialized and coalesced | `app/components/favorites-provider.tsx` |
| Catalog | Sale “was” price taken from the cheapest variant; load-more retry | `lib/products.ts`, `app/collections/collection-browse.tsx` |
| Account | Country dropdown from shop markets; newer/older order paging; truthful Placed → Paid → Shipped timeline | account pages |
| SEO | `/account` and `/search` disallowed in robots; `noindex` metadata | `app/robots.ts`, layouts |
| Content | Items flagged `demo` (placeholder links, unconfirmed promos) are hidden | `lib/site-content.ts` |
| Tests | `scripts/audit-unit.ts` also covers sale price, return paths, rate limiter, origin check, webhook signatures | `scripts/audit-unit.ts` |

Still open: policy pages, post-checkout thank-you, analytics/consent, Markets/i18n, variant option pickers, CI.

---

# 1. Executive Summary

## What this application is

A **headless Shopify storefront** for “ZJ Store” (Nike/Adidas demo catalog). The browser talks only to **Next.js**. Next.js talks to Shopify via GraphQL for catalog, cart, checkout URL, and customer account data. There is **no local customer/order database** and **no Prisma/Postgres**.

## Roles

| Layer | Role |
|-------|------|
| **Next.js 16.4.3 / React 19** | UI, routing, Server Components, Server Actions, Route Handlers, encrypted session cookies, SEO |
| **Shopify** | Source of truth for products, inventory availability (via Storefront fields), carts, hosted checkout/payment/orders, customer identity |

## Shopify APIs in use (verified)

1. **Storefront API** GraphQL `2026-10` — `lib/shopify.ts` → `https://{SHOPIFY_STORE_DOMAIN}/api/2026-10/graphql.json` with `X-Shopify-Storefront-Access-Token`
2. **Customer Account API** — discovery + GraphQL via `lib/customer-account/discovery.ts` / `api.ts`, OAuth 2.0 + PKCE confidential client (`lib/customer-account/oauth.ts`)
3. **Shopify-hosted Checkout** — redirect to cart `checkoutUrl` (not a custom checkout)

4. **Shopify admin webhooks** (added 2026-10-29) — product/collection/inventory events → `app/api/webhooks/shopify/route.ts`

**Not used (verified by absence):** Admin GraphQL API, Shopify Functions, Metaobjects API, Markets API, Hydrogen, Shopify app extensions, legacy Storefront customerAccessToken login (password-based). The Storefront customer token used for cart buyer identity is issued via the Customer Account API, not password login.

## Customer journey (verified)

Browse catalog → PDP → select variant → `CartProvider.addItem` → Server Action `addItem` → Shopify Cart API → httpOnly cart cookie → cart drawer / `/cart` → server-sanitized `checkoutUrl` → Shopify Checkout → payment/order on Shopify. Optional: login via CAA (cart linked to the customer) → account/orders/addresses/profile/favourites.

## Architectural quality

Strong for a learning/portfolio headless storefront: clear `lib/` vs `app/` split, server-only secrets, optimistic shared cart, stock-aware quantities, checkout URL allowlisting, JSON-LD escaping, CAA with AES-GCM cookie sessions and cart buyer identity, webhook-driven cache refresh, favourites via customer metafield. Remaining gaps vs large production shops: variant pagination caps, no CI/test runner, no Admin API app, no Markets.

## Portfolio / expertise level

This is a **viable, above-average Shopify headless portfolio project**. It demonstrates real Storefront Cart + Checkout security awareness **and** modern Customer Account API — beyond theme Liquid. Estimated demonstrated level: **strong mid-level headless Shopify frontend / solutions-leaning**, not app-platform expert.

### Scores (out of 10)

Scores updated 2026-10-29 where the original “why” cited gaps that are now closed.

| Dimension | Score | Why |
|-----------|------:|-----|
| **Shopify expertise** | **8.5** (was 8.0) | Storefront GraphQL, Cart API incl. warnings + buyer identity, filters/search, CAA OAuth/PKCE, metafields, webhooks, checkout hardening. Missing Admin API app/Functions/Markets. |
| **Next.js / frontend** | **8.0** (was 7.5) | App Router, RSC, Server Actions, Proxy, cache tags + `revalidateTag`, error boundaries, optimistic client cart. Cache Components still sharp-edge (`connection()` needed before `Date.now()`). |
| **Architecture** | **8.5** (was 8.0) | Clean boundaries; Shopify as SoT; no bogus customer DB; cart linked to customer; event-driven cache invalidation. |
| **Security** | **8.0** (was 7.5) | Tokens server-only; httpOnly cookies; checkout host validation; JSON-LD escape; hardened `returnTo`; signed webhooks; rate limiting; cross-site logout blocked. Rate limits are per instance (best effort). |
| **Production readiness** | **7.5** (was 6.5) | Core commerce + account work; error pages; stock limits; webhooks. Still: metafield Admin dependency, no CI, no policy pages, Markets/i18n absent. |
| **Portfolio value** | **8.5** | Rare combo of polished headless UX + CAA + security-conscious checkout — excellent interview talk track. |

---

# 2. Architecture

## ASCII diagram (actual components)

```text
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  Product cards, VariantSelector, CartProvider, CartDrawer,       │
│  CartView, CheckoutButton, FavoritesProvider, SearchDrawer,      │
│  Account forms                                                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router (Node / Vercel)                              │
│                                                                  │
│  Server Components          Client Components                    │
│  app/page.tsx               variant-selector.tsx                 │
│  products/[handle]          cart-view, checkout-button           │
│  collections/*              favorites-provider, site-header-shell│
│  cart/page.tsx              account address/profile forms        │
│  account/(protected)/*                                           │
│                                                                  │
│  Server Actions                 Route Handlers                   │
│  app/cart/actions.ts            /account/authorize|callback|…    │
│  addresses/profile/favourites   /api/predictive-search           │
│                                 /api/catalog                     │
│                                 /api/webhooks/shopify  ◄─ Shopify│
│                                 /cart/clear                      │
│                                                                  │
│  Cookies (httpOnly)                                              │
│  shopify-cart-id            (lib/cart-cookie.ts)                 │
│  zj-ca-session / zj-ca-id / zj-ca-pkce (AES-GCM sealed)          │
│                                                                  │
│  proxy.ts: rate limits · logout origin check · account returnTo  │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────┐
│ Storefront API 2026-10    │   │ Customer Account API            │
│ lib/shopify.ts            │   │ OAuth PKCE → access token       │
│ X-Shopify-Storefront-     │   │ Authorization: <access_token>   │
│ Access-Token (server env) │   │ lib/customer-account/*          │
│                           │   │ Profile, orders, addresses,     │
│ products, collections,    │   │ metafieldsSet favourites        │
│ search, cartCreate/lines, │   └────────────────┬────────────────┘
│ cart → checkoutUrl        │                    │
└─────────────┬─────────────┘                    │
              │                                  │
              ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  Shopify platform                                                │
│  Catalog · Cart · Hosted Checkout · Payments · Orders · Customers│
└─────────────────────────────────────────────────────────────────┘

Third-party npm (verified package.json): next, react, react-dom,
tailwindcss, typescript, eslint — no Shopify SDK, no auth library,
no ORM/DB client.
```

## Diagram explanation

- The **browser never holds the Storefront token** or CAA client secret.
- **Catalog/cart GraphQL** goes through `shopifyFetch` on the server (or via Server Actions / Route Handlers that call `lib/*`).
- **Checkout** leaves the Next app: the server sanitizes `checkoutUrl` (`toClientCart` in `lib/cart.ts` using `lib/checkout-url.ts`); `CheckoutButton` saves pending cart edits, then navigates.
- **Accounts** use Shopify as IdP; Next only stores sealed tokens in cookies.
- **`proxy.ts`** (Next 16’s Middleware) handles rate limits, the logout origin check and forwarding the current path for re-login; auth gates themselves stay in layouts/loaders (`requireCustomerSession`, redirects in CAA fetch).
- **Shopify → Next:** signed webhooks call `/api/webhooks/shopify`, which clears the `catalog` cache tag.

---

# 3. Project Structure

| Path | Responsibility | Depends on | Assessment |
|------|----------------|------------|------------|
| `app/` | Routes, UI, Server Actions, Route Handlers | `lib/*` | Appropriate App Router layout |
| `app/components/` | Shared chrome (header, cards, favourites, toasts) | `lib`, actions | Clear; some large shells (`site-header-shell.tsx`) |
| `app/cart/` | Cart page + mutations + checkout button + shared line item | `lib/cart`, cookies | Strong commerce core |
| `app/components/cart-provider.tsx`, `cart-drawer.tsx` | Shared client cart (optimistic, queued writes) + drawer | cart actions | Removes route re-renders on cart edits |
| `app/account/` | Login, OAuth routes, protected account, favourites page | `lib/customer-account` | Mature for portfolio |
| `app/collections/`, `products/`, `search/` | Catalog UX | `lib/collections`, `products`, `search`, `catalog-query` | Solid |
| `app/api/` | Predictive search + catalog JSON for infinite browse + Shopify webhook receiver | `lib/search`, catalog helpers | Thin BFF layer |
| `lib/shopify.ts` | Single Storefront HTTP client | env | Correct centralization |
| `lib/cart.ts` | Cart GraphQL mutations/queries | `shopifyFetch` | Production-minded (userErrors, flatten lines) |
| `lib/products.ts` / `collections.ts` / `search.ts` / `catalog*.ts` | Catalog domain | Storefront | Good mapping from connection edges |
| `lib/customer-account/` | Config, discovery, PKCE, session crypto, GraphQL | env, cookies | High expertise signal |
| `lib/checkout-url.ts` | Open-redirect defense | env hosts | Critical security piece |
| `lib/stock.ts` | Stock rules (limits, low stock, backorder, line issues) | — | Shared by PDP + cart |
| `lib/rate-limit.ts`, `lib/shopify-webhook.ts` | Pure limiter + HMAC verification | `node:crypto` | Unit-tested |
| `lib/localization.ts` | Shop markets for the address country list | Storefront | `"use cache"` (hours) |
| `lib/favourites.ts` | Intent/sessionStorage helpers, `safeReturnTo`, metafield constants | client + server | Supports login return flows |
| `lib/site-content.ts` | Marketing copy / nav intents | UI | Demo copy flagged in-file |
| `docs/` | Admin setup + this audit | humans | Useful |
| `scripts/` | Manual cart smoke + unit asserts | `lib` | Not wired into `npm test` |
| `public/` | Static assets | — | Standard |
| `.env.example` | Env contract | deploy | Good; secrets gitignored |
| `next.config.ts` | `cacheComponents`, images CDN, Tailwind turbopack | Next 16 | Modern; implications for `/_not-found` |
| `proxy.ts` | Rate limits, logout origin check, account return path | `lib/rate-limit.ts` | Added 2026-10-29 |
| `app/error.tsx` / `app/global-error.tsx` | Branded error pages with retry | — | Added 2026-10-29 |
| **No** GraphQL codegen folder | Inline strings in `lib/` | — | Acceptable at this size; less type-gen safety |

Separation of Shopify I/O in `lib/` with UI in `app/` is **appropriate** and interview-friendly.

---

# 4. Shopify Integration

## Integration inventory (verified)

| Shopify operation | File | Function | API | Purpose | Server/client | Cache | Security |
|---|---|---|---|---|---|---|---|
| Shop name/description | `lib/products.ts` | `getShop` | Storefront | Shop meta | Server | `revalidate: 120` | Token server-only |
| Product list | `lib/products.ts` | `getProducts` | Storefront `products` | Home/catalog | Server | 120s | Server |
| Product by handle | `lib/products.ts` | `getProductByHandle` | Storefront `product(handle)` | PDP + metadata | Server | 120s | Server |
| Products by IDs | `lib/products.ts` | `getProductsByIds` | Storefront `nodes(ids)` | Favourites grid | Server | 120s | Server |
| Collection by handle + filters | `lib/collections.ts` | `getCollectionByHandle` | Storefront `collection.products` + `filters` | PLP | Server | 120s | Server |
| Collections index | `lib/collections.ts` | `getCollectionsIndex` | Storefront | Collections hub / sitemap | Server | 120s | Server |
| Catalog snapshot | `lib/catalog-snapshot.ts` | `getCatalogSnapshot` | Storefront products/collections pages | Nav facets, sitemap | Server | via callers / cache | Server |
| Nav catalog | `lib/catalog.ts` | `getNavCatalog` | Storefront (probes + snapshot) | Header/footer | Server | `"use cache"` + `cacheLife("minutes")` | Server |
| Predictive search | `lib/search.ts` + `app/api/predictive-search/route.ts` | `predictiveSearch` | Storefront `predictiveSearch` | Search drawer | Server (API) | `revalidate: 60` | No token to client |
| Product search | `lib/search.ts` | `searchProducts` | Storefront `search` | `/search` | Server | catalog revalidate | Server |
| Cart create | `lib/cart.ts` | `createCart(lines, customerAccessToken?)` | `cartCreate` (lines + `buyerIdentity` in one call) | New cart | Server Action path | **no-store** | Cookie set httpOnly |
| Cart lines add | `lib/cart.ts` | `addToCart` | `cartLinesAdd` (+ `warnings`) | ATC | Server | no-store | Validates merchandiseId |
| Cart get | `lib/cart.ts` | `getCart` | `cart(id)` (+ stock fields, `updatedAt`) | Cart page / drawer / header qty | Server | no-store | Cookie id |
| Cart lines update/remove | `lib/cart.ts` | `updateCartLines` (batched) / `removeCartLine` | mutations (+ `warnings`) | Cart UI | Server | no-store | Server |
| Cart buyer identity | `lib/cart.ts` | `linkCartToCustomer` | `cartBuyerIdentityUpdate` | Link cart on login | Route Handler (callback) | no-store | Storefront customer token from CAA |
| Discount codes | `lib/cart.ts` | `updateCartDiscountCodes` | `cartDiscountCodesUpdate` | Cart discounts | Server | no-store | Length limits in actions |
| Checkout URL | cart fields → UI | `toClientCart` | Cart `checkoutUrl` | Leave to Shopify | Sanitized on server; client redirect | — | Host allowlist |
| Shop markets | `lib/localization.ts` | `getShippingCountries` | `localization.availableCountries` | Address country list | Server | `"use cache"` hours | Server |
| CAA OAuth authorize/token | `lib/customer-account/oauth.ts` | `begin/completeCustomerAuthorization` | OpenID + token | Login | Route Handlers | — | PKCE + confidential secret |
| Storefront customer token | `lib/customer-account/oauth.ts` | `createStorefrontCustomerToken` | CAA `storefrontCustomerAccessTokenCreate` | Cart buyer identity | Route Handler (callback) | no-store | Sealed in session cookie |
| Catalog webhooks | `app/api/webhooks/shopify/route.ts` | `POST` | Shopify admin webhooks → `revalidateTag` | Instant catalog refresh | Route Handler | — | HMAC-SHA256 verified |
| Customer profile | `lib/customer-account/api.ts` | `getCustomerProfile` | CAA GraphQL | Account shell | Server | no-store | Session cookie |
| Orders list/detail | `api.ts` | order queries | CAA | `/account/orders` | Server | no-store | Session |
| Addresses CRUD | `api.ts` | create/update/delete | CAA | Addresses UI | Server | no-store | Session |
| Profile update | `api.ts` | `customerUpdate` | CAA | Profile form | Server | no-store | Session |
| Favourites metafield get/set | `api.ts` | `get/setCustomerFavouriteIds` | CAA `metafield` / `metafieldsSet` | Wishlist | Server | no-store | Needs Admin definition |

**Credentials exposed to browser?** **No** Storefront token or CAA client secret in client bundles (verified: only server modules / `"use server"` / Route Handlers use them). Cart id and favourites product GIDs are not secrets.

---

# 5. Storefront API

## How communication works (verified)

| Concern | Implementation |
|---------|----------------|
| Endpoint | `https://${SHOPIFY_STORE_DOMAIN}/api/2026-10/graphql.json` (`lib/shopify.ts`) |
| Auth | Header `X-Shopify-Storefront-Access-Token` from `SHOPIFY_STOREFRONT_ACCESS_TOKEN` |
| Client | Custom `shopifyFetch<T>` — **no** official Shopify JS SDK |
| Errors | HTTP fail → throw; GraphQL `errors` → throw; missing `data` → throw. Message strings are generic (limited leak) |
| Timeout | `AbortSignal.timeout(20_000)` **only** on uncached (`cache: "no-store"`) requests |
| Retries | **None** |
| Caching | Catalog: `next: { revalidate: CATALOG_REVALIDATE, tags: ["catalog"] }` (120s backup; webhooks clear the tag). Cart: `cache: "no-store"` |
| Fragments | Shared field strings (`PRODUCT_CARD_FIELDS`, `VARIANT_FIELDS`, `cartFields`) — not GraphQL fragment documents |
| Types | Hand-written TS types; `as` casts on JSON parse — no codegen |

## End-to-end PDP request (verified)

```text
Customer opens /products/{handle}
        ↓
app/products/[handle]/page.tsx (Server Component)
        ↓
getProductByHandle(handle)  // lib/products.ts
        ↓
shopifyFetch(GetProductByHandle, { handle }, { revalidate: 120 })
        ↓
Shopify Storefront GraphQL 2026-10
        ↓
mapProductNode → ProductDetail
        ↓
generateMetadata + page render + JSON-LD
        ↓
VariantSelector (client) receives variants[]
```

---

# 6. Products

## Verified behavior

- **Listing:** `getProducts`, collection products, search, home carousels via collection previews.
- **Handles:** URL `/products/[handle]`; missing product → `notFound()`.
- **IDs:** Shopify GIDs (`id` on product/variant) used for favourites and cart merchandise.
- **Images:** `featuredImage` + `images(first: 4)` cards / `first: 12` PDP; CDN via `next.config.ts` `cdn.shopify.com`.
- **Prices:** `priceRange.minVariantPrice` for cards, with the “was” price taken from the cheapest variant; variant `price` / `compareAtPrice` for PDP/sale % (`salePercentOff`).
- **Availability:** `availableForSale` on product and variants; the PDP and cart also read `quantityAvailable` and `currentlyNotInStock` (backorder) via `lib/stock.ts`.
- **Pagination:** Connection `pageInfo` / `after` on products, collections, search; catalog browse loads more via `/api/catalog` (client).
- **Filtering:** Shopify `ProductFilter` inputs from collection `filters` + URL params (`collection-filters.tsx`, `catalog-query.ts`).
- **Currency:** Shopify money objects; display via `Intl` + `currencyDisplay: "code"` (`lib/money.ts`) — single-market display, not Markets-aware.

## Shopify-specific limitations / risks

| Issue | Severity | Notes |
|-------|----------|-------|
| Variants capped at **30** (cards) / **100** (PDP) with **no `pageInfo` pagination** | Medium | Products with >100 variants can miss SKUs |
| Images capped (4/12) | Low | Fine for most apparel |
| PDP stock cached up to 120s if a webhook is missed | Info | Shopify cart warnings still enforce the real limit |
| Variants that oversell with stock left are capped at that stock | Info | Storefront API doesn’t expose the inventory policy while stock > 0 |
| Demo marketing copy | Info | Flagged `demo` in `lib/site-content.ts` and hidden |

**Robust for a real mid-size apparel catalog?** **Mostly yes** for Nike/Adidas-style variant counts. **Not** robust for highly configurable products with huge variant matrices without variant pagination.

---

# 7. Variants

## Trace (verified)

```text
Shopify product.variants(first: 100)
   ↓
mapProductNode → ProductVariant{ id, availableForSale, price, selectedOptions, … }
   ↓
VariantSelector (client) — listbox; defaults to first available
   ↓
selectedVariant.id  (ProductVariant GID)
   ↓
useCart().addItem → addItem(variantId, quantity)  // app/cart/actions.ts
   ↓
addToCart(cartId, merchandiseId, quantity)  // merchandiseId = variant GID
   ↓
cartLinesAdd(lines: [{ merchandiseId, quantity }])
```

**Correct merchandise identifier:** Yes — Storefront Cart expects ProductVariant GID; code uses `merchandiseId` consistently (`lib/cart.ts`).

## Findings

- No hardcoded “first variant only” ATC on PDP (selector required).
- Sold-out variants labeled; cannot add if `availableForSale !== true`.
- Quantity clamped 1–99 in actions and cart helpers, and to available stock minus what’s already in the bag on the PDP.
- Single-variant products (“Default Title”) show no variant picker.
- **Client/server:** prices shown from server-fetched props; ATC re-validates on Shopify (userErrors).
- **Gap:** no option-axis UI (Size/Color matrices) — flat variant title list; fine for many catalogs, weaker UX for complex options.

---

# 8. Cart

## First visit / cart page (verified)

```text
Customer → /cart
  ↓
cookies().get("shopify-cart-id")
  ↓
missing → empty state
  ↓
present → getCart(cartId)  // no-store
  ↓
null cart → /cart/clear clears the cookie
  ↓
CartView seeds CartProvider (useSeededCart) — newer client cart wins by `updatedAt`
```

Header quantity: `SiteHeader` server-renders the count; once `CartProvider` holds a cart, the header shows the live count (the layout isn’t re-rendered on soft navigation).

## Add to cart (verified)

```text
VariantSelector → useCart().addItem(variantId, qty)
  ↓ (queued; one write at a time)
Server Action addItem
  ↓
cookie? → cartLinesAdd   |   none / invalid cart → cartCreate(lines, buyerIdentity?) + set cookie
  ↓
returns full cart + stock notices (from Shopify `warnings`)
  ↓
CartProvider commits the cart; drawer opens
```

No `revalidatePath` / `refresh()`: the client already has the fresh cart, so mutations don’t re-render the route.

## Updates

- **Quantity:** applied on screen immediately; edits within 350 ms are batched into one `cartLinesUpdate`. Line totals and subtotal are computed client-side until Shopify confirms; discount-dependent totals show a small spinner.
- **Queue:** all cart writes run one at a time, so rapid changes can’t race.
- **Failure:** the edit is rolled back and the line shows the error. A gone cart (`cartGone`) empties the client cart and shows a toast.
- **Stock:** quantities are capped to available stock; Shopify’s `MERCHANDISE_NOT_ENOUGH_STOCK` / `OUT_OF_STOCK` warnings appear as line notices, and Shopify’s saved quantity always wins.
- **Checkout:** `CheckoutButton` flushes pending edits before redirecting, and is blocked while any line is sold out or over stock.
- Stale/expired cart: `isInvalidCartError` heuristics → recreate cart on add; `/cart/clear` clears cookie.

## Persistence (verified)

| Attribute | Value |
|-----------|--------|
| Cookie name | `shopify-cart-id` |
| httpOnly | **true** |
| sameSite | `lax` |
| path | `/` |
| maxAge | 30 days |
| secure | production (`NODE_ENV === "production"`) |

**Buyer identity:** linked on login and on carts created while signed in (see §10). Logout clears the cart cookie.

**Weaknesses:** Multi-device carts won’t merge (the cart lives in one browser’s cookie). Cookie secure flag tied to `NODE_ENV` only (CAA cookies also check `VERCEL`) — minor inconsistency.

---

# 9. Checkout

## Flow (verified)

```text
getCart / cart mutation → checkoutUrl
  ↓
toClientCart: isSafeShopifyCheckoutUrl(checkoutUrl, allowedHosts) — unsafe URL blanked on the server
  ↓
CartView / CartDrawer → CheckoutButton (requires https; blocked on stock issues)
  ↓
await flush()  // pending quantity edits saved first
  ↓
window.location.assign(checkoutUrl)
  ↓
Shopify-hosted Checkout → Payment → Order (Shopify)
```

## What Next.js controls vs not

| Controlled by Next | Controlled by Shopify |
|--------------------|------------------------|
| Showing cart, validating URL host/protocol | Checkout UI, payment, fraud, order creation |
| Blocking evil redirects | Post-checkout customer emails, thank-you page |
| — | “Continue shopping” / return URLs **inside** Shopify checkout Admin settings |

**Open redirect:** Mitigated by HTTPS-only, no userinfo, host allowlist (`checkout.shopify.com`, store domain, `SITE_URL` host) — **verified** in `lib/checkout-url.ts` + unit script `scripts/audit-unit.ts`.

## “Continue shopping” in this repo

In-store CTAs link to **`/collections/all`** (cart empty, account, 404, etc.) — verified. That is **storefront** navigation, not Shopify checkout’s continue-shopping control. Post-payment return behavior is **not** implemented in Next (no order status page webhook flow). **Inferred:** Shopify Admin “Order status page” / checkout settings govern return to merchant after pay.

---

# 10. Customer Accounts

## Current status — **IMPLEMENTED** (verified)

Contrary to a “accounts not built” checklist: this repo has a full **Customer Account API** stack.

| Capability | Status | Evidence |
|------------|--------|----------|
| Login / signup | Via Shopify hosted login (same OAuth) | `app/account/login`, `authorize`, `callback` |
| Logout | Session clear + end_session | `app/account/logout`, `buildCustomerLogoutUrl` |
| Session | Encrypted httpOnly cookies, chunked, refresh | `lib/customer-account/session.ts`, `refresh` route |
| `/account` | Protected overview | `app/account/(protected)` |
| Orders + detail | CAA queries | `api.ts`, orders pages |
| Addresses CRUD | CAA mutations | addresses actions + UI |
| Profile | CAA update | profile page |
| Favourites | Metafield `custom.favourites` JSON; saves serialized; never overwrites a list that failed to load | `api.ts`, FavoritesProvider |
| Cart buyer identity | Storefront customer token from `storefrontCustomerAccessTokenCreate`, applied via `cartBuyerIdentityUpdate` on login and `buyerIdentity` on new carts | `oauth.ts`, `lib/cart.ts`, `app/cart/actions.ts` |
| Re-login return | Expired/missing session → `/account/authorize?returnTo=<current page>` | `api.ts`, `require-session.ts`, `proxy.ts` |
| Legacy Storefront customerAccessToken | **Not present** | grep-negative |
| Prisma/Postgres | **Not present / not needed** for customers/orders | package.json |

**Prisma would not be required** to show orders — Shopify remains source of truth. A DB would only be justified for app-owned data Shopify shouldn’t store (e.g. heavy analytics, non-metafield app state).

**Buyer identity (closed 2026-10-29):** the cart is linked to the customer after login, so checkout is tied to their account. Linking is best effort and never blocks login. **Inferred:** relies on Shopify issuing the Storefront customer token for this shop; failures are logged.

---

# 11. Security

| Finding | Severity | Evidence / notes |
|---------|----------|------------------|
| Storefront token only on server | — (good) | `lib/shopify.ts`, no `NEXT_PUBLIC_` token in `.env.example` |
| CAA client secret server-only | — (good) | `lib/customer-account/config.ts` |
| Cart cookie httpOnly + lax | — (good) | `lib/cart-cookie.ts` |
| Session cookies AES-256-GCM sealed | — (good) | `session.ts` |
| Checkout URL allowlist | — (good) | Previous open-redirect class issue **addressed** in current code |
| JSON-LD `<` escaped to `\u003c` | — (good) | `products/[handle]/page.tsx` — prior XSS class **addressed** |
| OAuth `returnTo` sanitized | — (good) | `safeReturnTo` in `lib/favourites.ts` resolves the URL and requires the same origin (blocks `//host`, `/\host`, tab/newline tricks); used by login **and** `/account/refresh` (the refresh route previously only checked `startsWith("/")` — fixed 2026-10-29) |
| Rate limiting | — (good, best effort) | `proxy.ts` + `lib/rate-limit.ts`: 60/min search and catalog, 120/min Server Actions, per IP; in-memory per server instance |
| Logout CSRF | — (good) | `proxy.ts` rejects `POST /account/logout` without a same-origin `Origin` (403) |
| Webhook authenticity | — (good) | HMAC-SHA256 over the raw body, `timingSafeEqual` (`lib/shopify-webhook.ts`) |
| Server Action CSRF | INFORMATIONAL | Relies on Next.js Server Action origin checks (**inferred**, not re-proven here) |
| Shopify error text in UI | — (good) | Account actions log API detail and show a generic message; Shopify `userErrors` (validation) still shown |
| Favourites product IDs in sessionStorage intent | LOW | Same-origin; not secret |
| No security headers config in `next.config.ts` | LOW | CSP/HSTS typically at Vercel/CDN — **not verified** in repo |
| Account/search crawlability | — (good) | `/account` and `/search` disallowed in robots; `noindex` metadata |
| Logging | INFORMATIONAL | `console.error` on authorize, account and webhook failures |

**CRITICAL / HIGH:** None verified in current code for the classic checkout redirect / JSON-LD breakout issues — both appear fixed.

---

# 12. Next.js Architecture

| Feature | Usage |
|---------|--------|
| Server Components | Default for pages/layouts |
| Client Components | Interactive cart, variants, filters, favourites, header |
| Server Actions | Cart, addresses, profile, favourites |
| Route Handlers | OAuth, search API, catalog API, cart clear, Shopify webhooks |
| Suspense | Header/footer chrome (`site-shell.tsx`), cart recommendations |
| Cache Components | `cacheComponents: true` in `next.config.ts`; `connection()` before `Date.now()` in the CAA session check |
| `"use cache"` | `getNavCatalog`, `getCartRecommendations`, `getShippingCountries` |
| Cache tags | `catalog` on all cached Storefront fetches + `cacheTag`; cleared by `revalidateTag("catalog", { expire: 0 })` |
| Metadata | Root + product/collection/search; `noindex` on account and search |
| `not-found` | `app/not-found.tsx` |
| `error.tsx` | `app/error.tsx` + `app/global-error.tsx` (use `retry`) |
| Proxy (Middleware) | `proxy.ts` — Node runtime |
| Images | `next/image` + Shopify CDN remotePatterns |

## `/_not-found` prerender failure (explained, not fixed)

With **Cache Components**, Next prerenders a synthetic `/_not-found` route that **inherits the root layout**. If the root layout (or chrome it renders) reads **`cookies()` / uncached `fetch`** outside `<Suspense>`, build fails with “uncached or runtime data during prerendering” on `/_not-found`.

**Current code intent (verified):** `app/components/site-shell.tsx` comment states root chrome must stay prerenderable; cookie-bound `SiteHeader` and catalog footer are wrapped in `<Suspense>` with deterministic fallbacks.

**Cannot verify without running `next build` in this audit** whether the failure is fully gone in CI/local. Architecturally the Suspense split is the correct mitigation.

---

# 13. Caching & Performance

| Data | Strategy | Should be |
|------|----------|-----------|
| Catalog / PDP / collections | `revalidate: 120` + tag `catalog` | Webhook-refreshed; timer is backup ✓ |
| Nav catalog | `"use cache"` + `cacheLife("minutes")` + `cacheTag("catalog")` | Cached ✓ |
| Cart recommendations | `"use cache"` hours + `cacheTag("catalog")`, streamed in Suspense | Never blocks the cart ✓ |
| Predictive search | `revalidate: 60` | Short cache OK |
| Cart | `no-store` | Always dynamic ✓ |
| CAA | `no-store` | Always dynamic ✓ |
| Header cart count | Server-rendered once, then live from `CartProvider` | No extra call per cart edit ✓ |
| Cart edits | One mutation per batch; no route re-render | Down from ~5 Storefront calls per click ✓ |
| PDP cart load | Only when the variant is low stock (≤ 5) | Avoids a cart call on most product views ✓ |

**Risks:** Duplicate catalog fetches across layout/page (partially mitigated by cache); favourites `nodes` chunking; `inventory_levels/update` webhooks clear the whole catalog tag on every sale (fine at this size); the 120s timer can be raised once webhooks are confirmed in production.

---

# 14. SEO

| Item | Status |
|------|--------|
| Root metadata + OG | Yes (`app/layout.tsx`) |
| Product title/description/canonical/OG image | Yes (`generateMetadata` on PDP) |
| Collection metadata | Yes |
| JSON-LD Product | Yes, escaped |
| Sitemap | Dynamic products/collections (`app/sitemap.ts`) if `SITE_URL` set |
| Robots | Allow `/`; disallow cart, api, account, search |
| `noindex` | Account (`noindex, nofollow`), search (`noindex, follow`) |
| Twitter card extras | Minimal / not elaborate |
| Account/favourites in sitemap | Not added (good) |

**Sufficient for a real storefront MVP:** Yes for basic organic PDP indexing. Gaps: richer Product JSON-LD (SKU, multiple offers per variant), hreflang/Markets, breadcrumb schema.

---

# 15. Error Handling

| Shopify failure | App behavior (verified / inferred) |
|-----------------|-------------------------------------|
| Timeout (uncached) | Throw “Shopify request timed out.” → action returns friendly message |
| GraphQL errors | Throw; cart actions map to generic UI errors |
| `userErrors` on cart | Thrown joined messages → caught → generic or recreate cart |
| Null product | `notFound()` |
| Unavailable variants | UI blocks ATC |
| Null/expired cart | null handling + recreate / `/cart/clear`; `cartGone` empties the client cart |
| Stock shortfall | Shopify caps the line; notice shown; checkout blocked until fixed |
| CAA 401 / expiring token | Redirect to refresh; the redirect now escapes action `catch` blocks (`unstable_rethrow`) |
| Account API failure | Generic message to the shopper; detail logged |
| Order detail API failure | Error panel (malformed id → 404; outage no longer shown as 404) |
| Catalog load-more failure | “Couldn’t load more products” + **Try again**; auto-load paused |
| Favourites metafield denied | Friendly toast string in `app/favourites/actions.ts` |
| Favourites load failure | Never saved over; reloaded before the next toggle |
| Route-level React error | `app/error.tsx` (keeps header) / `app/global-error.tsx` |

Graceful for commerce and account paths, including unexpected render errors.

---

# 16. Testing

| Artifact | Type | Touches Shopify? |
|----------|------|------------------|
| `scripts/audit-unit.ts` | Automated asserts (run via `npx tsx`) | No — checkout URL, money, sale %, cheapest-variant compare-at, `safeReturnTo` redirect payloads, rate limiter, origin check, webhook signatures |
| `scripts/test-cart.ts` | Manual/integration smoke | **Yes** — create cart + add line (needs env + handle) |
| `npm test` | **None** | — |
| Playwright/Cypress | **None** | — |
| `npm run lint` / `build` | Quality gates | Build would hit Shopify if pages fetch at build — depends on cache/env |

**Distinction:** Owner has **manually** tested full checkout through Shopify payment (**stated by audit request** — not re-verified here). Automated suite does **not** cover payment completion.

---

# 17. Production Readiness

| Area | Verdict |
|------|---------|
| Catalog / PDP / variants / cart / checkout | Ready for demo / soft launch |
| Account / orders / addresses / favourites | Ready if Admin CAA + metafield configured |
| Secrets / redirects / cookies | Solid; rate limiting and signed webhooks added |
| Caching | Webhook invalidation via cache tags; timer as backup |
| Reliability | Good cart recovery; error boundaries; stock-aware cart |
| SEO | MVP solid; private routes excluded |
| Deploy | Vercel-oriented; `.env.example` complete; **no** `vercel.json` in repo |
| Buyer identity | Done |
| Markets / i18n | Not production-complete for multi-market brands |
| Content | Policy pages, thank-you page, analytics/consent still missing |

**Production-readiness score: 7.5 / 10** (was 6.5) — shippable as a branded headless store once policy pages exist and webhooks are registered in Admin; not yet “enterprise catalog” complete (Markets, variant pagination, CI).

---

# 18. Shopify Expertise Assessment

## Already demonstrated (verified)

- Headless architecture with Next as experience layer  
- Storefront API GraphQL (products, collections, filters, search, predictive search)  
- Cart API lifecycle + cookie persistence  
- Shopify-hosted checkout with **redirect security**  
- Money/compare-at/sale modeling  
- Customer Account API OAuth PKCE confidential client  
- Customer orders, addresses, profile  
- Customer metafields for wishlist  
- Awareness of Storefront connection pagination and variant limits  
- Cart buyer identity from Customer Account login  
- Cart `warnings` and inventory-aware quantities  
- Webhooks with HMAC verification driving cache-tag revalidation  
- Optimistic cart UX with serialized, batched mutations  

## Not demonstrated yet (verified absent)

- Admin GraphQL API / custom apps  
- Shopify Functions (discounts, shipping)  
- Metaobjects as content model  
- Markets / international pricing  
- Checkout UI extensions  
- Hydrogen / Oxygen  
- Theme app extensions / Liquid themes  

---

# 19. Portfolio Scores

| Dimension | Score | Explanation |
|-----------|------:|-------------|
| Shopify expertise (employer signal) | **8/10** | Far beyond theme tweaks; CAA + cart security are persuasive |
| Headless Shopify | **8.5/10** | Complete browse→buy→account loop |
| Engineering quality | **7.5/10** | Clean structure; tests/error UX thinner |
| E-commerce knowledge | **8/10** | Correct cart vs checkout vs order boundaries |
| Interview value | **9/10** | Rich stories: open redirect, JSON-LD XSS, PKCE cookies, metafields, Cache Components |
| Overall portfolio value | **8.5/10** | **Yes — put on resume** with Admin setup + live demo URL |

---

# 20. Role-by-Role Assessment

| Role | Current strength | Missing for that role |
|------|------------------|------------------------|
| Shopify Theme Developer | Low–Med | Little Liquid/theme Online Store 2.0 |
| Shopify Frontend Developer | High | Theme sections; could add more OS2 familiarity |
| Headless Shopify Developer | **Very high** | Markets, variant option pickers |
| Shopify App Developer | Low | No Admin API app, OAuth app install, extensions |
| Shopify Full-Stack Developer | Med–High | Webhooks done; add Admin API or a lightweight app backend |
| Shopify Solutions Engineer | High | Great demo architecture; add multi-market + integration story |

---

# 21. Highest-Value Improvements

Ranked for **Shopify expertise signal**, not feature count.

### ~~Priority 1 — Cart buyer identity after login~~ — **Done (2026-10-29)**
- Storefront customer token from `storefrontCustomerAccessTokenCreate`; `cartBuyerIdentityUpdate` on login, `buyerIdentity` on new carts.

### ~~Priority 2 — Webhook-driven catalog revalidation~~ — **Done (2026-10-29)**
- Admin webhooks → `/api/webhooks/shopify` (HMAC verified) → `revalidateTag("catalog", { expire: 0 })`. Remaining step: register the webhooks in Admin and set `SHOPIFY_WEBHOOK_SECRET`.

### Priority 3 — Variant connection pagination / option UX
- **What:** Paginate variants; Size/Color pickers from `selectedOptions`.  
- **Why:** Shows Storefront connection mastery.  
- **Difficulty:** Medium. **Value:** High for “real catalog” credibility.

### Priority 4 — Automated commerce regression tests
- **What:** Wire `audit-unit` + mocked `shopifyFetch` cart tests into CI; optional Playwright happy path to checkout URL (not payment).  
- **Difficulty:** Low–Med. **Value:** High engineering signal.

### Priority 5 — Markets (only if multi-currency is a goal)
- **What:** `@inContext` / market headers.  
- **Difficulty:** High. **Value:** High for international SE roles; skip if single market.

### Evaluate popular asks

| Idea | Worth it now? |
|------|----------------|
| Customer Account API | **Already done**, incl. buyer identity |
| Customer orders | **Already done** |
| Admin GraphQL | Yes if targeting app/full-stack roles |
| Webhooks | **Done** (catalog revalidation) |
| Functions | Optional; heavy for portfolio ROI |
| Metaobjects | Nice for CMS story; also a good source for policy/marketing content |
| Markets | If multi-region narrative needed |
| Advanced caching | **Done** — cache tags + webhooks |
| Search | **Already done** (predictive + search) |
| Wishlist | **Already done** (metafield) |

**Do not add Prisma/Postgres** just to mirror customers/orders.

---

# 22. Interview Explanation

## Explain this project to me like I'm preparing for an interview

**Customer opens the website.** The request hits a Next.js App Router app. The root layout renders `SiteShell`: announcement bar, a Suspense-wrapped header (so cookie/cart reads don’t block the static shell), page content, and footer. Nav links come from cached Storefront probes (`getNavCatalog`).

**Browse products.** Home and collection routes call `shopifyFetch` against Storefront API 2026-10 with the server-side Storefront access token. Products arrive as GraphQL connections (edges/nodes). We map them into typed `ProductListItem`s with images, price range, tags, and a page of variants. Collections can apply Shopify’s `ProductFilter`s and sort keys; the UI syncs filters to the URL.

**Select a variant.** On the PDP, `getProductByHandle` loads richer fields (up to 100 variants, with `quantityAvailable`). `VariantSelector` is a client component: it picks an available variant GID and caps the quantity at what’s in stock minus what’s already in the bag, showing “Only N left” when low.

**Add to Shopify cart.** Clicking add goes through a client `CartProvider` that queues every cart write, then calls Server Action `addItem`. That reads httpOnly cookie `shopify-cart-id`. If missing or invalid, it `cartCreate`s with the line in one call (and the customer’s buyer identity if signed in); otherwise `cartLinesAdd` with `merchandiseId` = variant GID. The action returns the full cart plus any Shopify stock `warnings`, and the drawer opens. Cart calls use `cache: "no-store"`.

**Cart persistence / update.** Quantity changes update the screen instantly; a burst of clicks becomes one `cartLinesUpdate`. Because each action returns the cart, nothing re-renders on the server. If Shopify saves less than asked (stock), its quantity wins and the line says why.

**Checkout.** Shopify returns `checkoutUrl` on the cart. The server only passes it to the browser if it’s HTTPS on an allowlisted host (`checkout.shopify.com`, our myshopify domain, or `SITE_URL` host). `CheckoutButton` saves any pending edits, refuses while a line is sold out or over stock, then `window.location.assign`s. From that moment, **payment and order creation are 100% Shopify-hosted**. Next does not process cards.

**Login → Customer Account API → orders.** “Account” starts OAuth PKCE (`/account/authorize`): we store state/verifier/(returnTo) in an encrypted cookie, send the user to Shopify’s authorization endpoint, then `/account/callback` exchanges the code for tokens, exchanges those for a Storefront customer token, links the cart to the customer, and seals everything in `zj-ca-session`. Protected pages call Customer Account GraphQL with `Authorization: <access_token>` (not Bearer — per this integration). We load profile, orders, addresses, and can read/write `custom.favourites` JSON metafield for the wishlist.

**Keeping the catalog fresh.** All cached Storefront data is tagged `catalog`. Shopify admin webhooks POST product/collection/inventory changes to `/api/webhooks/shopify`; we verify the HMAC and call `revalidateTag("catalog", { expire: 0 })`, so edits show within seconds. A 2-minute timer remains as a backup.

**What I would say about expertise:** This isn’t a theme — it’s a real headless commerce BFF pattern: Shopify owns commerce truth; Next owns UX, session glue, cache invalidation and security boundaries (tokens, checkout redirects, XSS-safe JSON-LD, signed webhooks, rate limits).

---

# 23. Final Verdict

This repository is a **credible, interview-ready headless Shopify storefront** with unusually strong coverage for its size: Storefront catalog/cart/checkout **plus** Customer Account API, favourites metafields, and deliberate security fixes around checkout redirects and JSON-LD.

It will convince most Shopify employers you understand **headless Storefront architecture**, not merely Liquid themes. Buyer identity and webhook revalidation are now in place (2026-10-29). To push further toward “production engineer / solutions lead,” prioritize **CI with automated tests**, **variant option UX**, and **policy pages / Markets** — not a customer database.

**Overall: ship it on the portfolio, demo the live checkout + account login, and prepare the interview narrative in §22.**

---

*End of audit. Generated from repository inspection on 2026-10-28; updated 2026-10-29 for the changes in §0. Shopify Admin configuration and live payment rails were not directly verified.*
