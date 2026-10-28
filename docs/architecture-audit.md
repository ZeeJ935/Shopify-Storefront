# Complete Shopify Storefront Architecture & Expertise Audit

**Repository:** `zj-headless-storefront`  
**Audit date:** 2026-10-28  
**Scope:** Read-only inspection of the current codebase. No files were modified for this audit (this document is the deliverable).  
**Verification note:** Claims marked **Verified** come from source inspection. Claims marked **Inferred** are reasoned from code/config but not runtime-proven. Shopify Admin settings, live production infra, and payment completion were **not** inspected in Admin / payment processors.

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

**Not used (verified by absence):** Admin GraphQL API, webhooks, Shopify Functions, Metaobjects API, Markets API, Hydrogen, Shopify app extensions, legacy Storefront customerAccessToken login.

## Customer journey (verified)

Browse catalog → PDP → select variant → Server Action `addItem` → Shopify Cart API → httpOnly cart cookie → `/cart` → validated `checkoutUrl` → Shopify Checkout → payment/order on Shopify. Optional: login via CAA → account/orders/addresses/profile/favourites.

## Architectural quality

Strong for a learning/portfolio headless storefront: clear `lib/` vs `app/` split, server-only secrets, cart recovery, checkout URL allowlisting, JSON-LD escaping, CAA with AES-GCM cookie sessions, favourites via customer metafield. Gaps vs large production shops: no buyer identity on cart, variant pagination caps, thin automated tests, no `error.tsx`, no Admin/webhooks/Markets.

## Portfolio / expertise level

This is a **viable, above-average Shopify headless portfolio project**. It demonstrates real Storefront Cart + Checkout security awareness **and** modern Customer Account API — beyond theme Liquid. Estimated demonstrated level: **strong mid-level headless Shopify frontend / solutions-leaning**, not app-platform expert.

### Scores (out of 10)

| Dimension | Score | Why |
|-----------|------:|-----|
| **Shopify expertise** | **8.0** | Storefront GraphQL, Cart API, filters/search, CAA OAuth/PKCE, metafields, checkout hardening — broad for a storefront repo. Missing Admin/webhooks/Functions/Markets. |
| **Next.js / frontend** | **7.5** | App Router, RSC, Server Actions, Suspense for chrome, `"use cache"` nav, polished UI. Thin error boundaries; Cache Components still sharp-edge. |
| **Architecture** | **8.0** | Clean boundaries; Shopify as SoT; no bogus customer DB. Cart↔customer not linked. |
| **Security** | **7.5** | Tokens server-only; httpOnly cookies; checkout host validation; JSON-LD escape; returnTo sanitization. CAA token in Authorization header (Shopify pattern). No CSRF tokens on Server Actions (Next built-in origin checks — inferred). |
| **Production readiness** | **6.5** | Core commerce + account work; metafield Admin dependency; buyer identity gap; test coverage thin; Markets/i18n absent. |
| **Portfolio value** | **8.5** | Rare combo of polished headless UX + CAA + security-conscious checkout — excellent interview talk track. |

---

# 2. Architecture

## ASCII diagram (actual components)

```text
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  Product cards, VariantSelector, CartView, CheckoutButton,       │
│  FavoritesProvider, SearchDrawer, Account forms                  │
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
│                                 /cart/clear                      │
│                                                                  │
│  Cookies (httpOnly)                                              │
│  shopify-cart-id            (lib/cart-cookie.ts)                 │
│  zj-ca-session / zj-ca-id / zj-ca-pkce (AES-GCM sealed)          │
│                                                                  │
│  No middleware.ts found                                          │
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
- **Checkout** leaves the Next app: client navigates to Shopify’s `checkoutUrl` after allowlist checks (`lib/checkout-url.ts`, `app/cart/checkout-button.tsx`, `app/cart/page.tsx`).
- **Accounts** use Shopify as IdP; Next only stores sealed tokens in cookies.
- **No `middleware.ts`** — auth gates are layout/loaders (`requireCustomerSession`, redirects in CAA fetch).

---

# 3. Project Structure

| Path | Responsibility | Depends on | Assessment |
|------|----------------|------------|------------|
| `app/` | Routes, UI, Server Actions, Route Handlers | `lib/*` | Appropriate App Router layout |
| `app/components/` | Shared chrome (header, cards, favourites, toasts) | `lib`, actions | Clear; some large shells (`site-header-shell.tsx`) |
| `app/cart/` | Cart page + mutations + checkout button | `lib/cart`, cookies | Strong commerce core |
| `app/account/` | Login, OAuth routes, protected account, favourites page | `lib/customer-account` | Mature for portfolio |
| `app/collections/`, `products/`, `search/` | Catalog UX | `lib/collections`, `products`, `search`, `catalog-query` | Solid |
| `app/api/` | Predictive search + catalog JSON for infinite browse | `lib/search`, catalog helpers | Thin BFF layer |
| `lib/shopify.ts` | Single Storefront HTTP client | env | Correct centralization |
| `lib/cart.ts` | Cart GraphQL mutations/queries | `shopifyFetch` | Production-minded (userErrors, flatten lines) |
| `lib/products.ts` / `collections.ts` / `search.ts` / `catalog*.ts` | Catalog domain | Storefront | Good mapping from connection edges |
| `lib/customer-account/` | Config, discovery, PKCE, session crypto, GraphQL | env, cookies | High expertise signal |
| `lib/checkout-url.ts` | Open-redirect defense | env hosts | Critical security piece |
| `lib/favourites.ts` | Intent/sessionStorage helpers + metafield constants | client + server | Supports login return flows |
| `lib/site-content.ts` | Marketing copy / nav intents | UI | Demo copy flagged in-file |
| `docs/` | Admin setup + this audit | humans | Useful |
| `scripts/` | Manual cart smoke + unit asserts | `lib` | Not wired into `npm test` |
| `public/` | Static assets | — | Standard |
| `.env.example` | Env contract | deploy | Good; secrets gitignored |
| `next.config.ts` | `cacheComponents`, images CDN, Tailwind turbopack | Next 16 | Modern; implications for `/_not-found` |
| **No** `middleware.ts` | — | — | Verified absent |
| **No** `error.tsx` / `global-error.tsx` | — | — | Gap |
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
| Cart create | `lib/cart.ts` | `createCart` | `cartCreate` | New cart | Server Action path | **no-store** | Cookie set httpOnly |
| Cart lines add | `lib/cart.ts` | `addToCart` | `cartLinesAdd` | ATC | Server | no-store | Validates merchandiseId |
| Cart get | `lib/cart.ts` | `getCart` | `cart(id)` | Cart page / header qty | Server | no-store | Cookie id |
| Cart lines update/remove | `lib/cart.ts` | `updateCartLine` / `removeCartLine` | mutations | Cart UI | Server | no-store | Server |
| Discount codes | `lib/cart.ts` | `updateCartDiscountCodes` | `cartDiscountCodesUpdate` | Cart discounts | Server | no-store | Length limits in actions |
| Checkout URL | cart fields → UI | — | Cart `checkoutUrl` | Leave to Shopify | Server fetch; client redirect | — | Host allowlist |
| CAA OAuth authorize/token | `lib/customer-account/oauth.ts` | `begin/completeCustomerAuthorization` | OpenID + token | Login | Route Handlers | — | PKCE + confidential secret |
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
| Caching | Catalog: `next: { revalidate: CATALOG_REVALIDATE }` (120s). Cart: `cache: "no-store"` |
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
- **Prices:** `priceRange.minVariantPrice` for cards; variant `price` / `compareAtPrice` for PDP/sale % (`salePercentOff`).
- **Availability:** `availableForSale` on product and variants — **not** `quantityAvailable` / inventory policy (verified absent).
- **Pagination:** Connection `pageInfo` / `after` on products, collections, search; catalog browse loads more via `/api/catalog` (client).
- **Filtering:** Shopify `ProductFilter` inputs from collection `filters` + URL params (`collection-filters.tsx`, `catalog-query.ts`).
- **Currency:** Shopify money objects; display via `Intl` + `currencyDisplay: "code"` (`lib/money.ts`) — single-market display, not Markets-aware.

## Shopify-specific limitations / risks

| Issue | Severity | Notes |
|-------|----------|-------|
| Variants capped at **30** (cards) / **100** (PDP) with **no `pageInfo` pagination** | Medium | Products with >100 variants can miss SKUs |
| Images capped (4/12) | Low | Fine for most apparel |
| No inventory quantity UI | Low–Med | Stock truth is boolean `availableForSale` only |
| Catalog revalidate 120s | Info | Stale prices/availability window |
| Demo marketing copy | Info | `lib/site-content.ts` |

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
addItem(variantId, quantity)  // app/cart/actions.ts
   ↓
addToCart(cartId, merchandiseId, quantity)  // merchandiseId = variant GID
   ↓
cartLinesAdd(lines: [{ merchandiseId, quantity }])
```

**Correct merchandise identifier:** Yes — Storefront Cart expects ProductVariant GID; code uses `merchandiseId` consistently (`lib/cart.ts`).

## Findings

- No hardcoded “first variant only” ATC on PDP (selector required).
- Sold-out variants labeled; cannot add if `availableForSale !== true`.
- Quantity clamped 1–99 in actions and cart helpers.
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
null cart → treat as empty / clear path via /cart/clear
```

Header quantity: `SiteHeader` reads cookie + `getCart` (inside Suspense).

## Add to cart (verified)

```text
VariantSelector → addItem(variantId, qty)
  ↓
existing cookie? getCart
  ↓
addToCart OR on invalid cart → createCart + addToCart + set cookie
  ↓
revalidatePath("/cart"); refresh()
```

## Updates

- Quantity / remove / discount codes via Server Actions in `app/cart/actions.ts`.
- `userErrors` surfaced as thrown errors → user-facing generic messages.
- Loading: `useTransition` + delayed pending labels.
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

**Weaknesses:** Cart not associated with logged-in customer (`buyerIdentity` / customer access token **absent** — verified). Multi-device carts won’t merge. Cookie secure flag tied to `NODE_ENV` only (CAA cookies also check `VERCEL`) — minor inconsistency.

---

# 9. Checkout

## Flow (verified)

```text
getCart → checkoutUrl
  ↓
app/cart/page.tsx: isSafeShopifyCheckoutUrl(checkoutUrl, allowedHosts)
  ↓
CartView → CheckoutButton
  ↓
Client re-check isSafeShopifyCheckoutUrl
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
| Favourites | Metafield `custom.favourites` JSON | `api.ts`, FavoritesProvider |
| Legacy Storefront customerAccessToken | **Not present** | grep-negative |
| Prisma/Postgres | **Not present / not needed** for customers/orders | package.json |

**Prisma would not be required** to show orders — Shopify remains source of truth. A DB would only be justified for app-owned data Shopify shouldn’t store (e.g. heavy analytics, non-metafield app state).

**Gap:** Cart **buyer identity** not attached after login — logged-in checkout may not auto-associate customer (verified absent).

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
| OAuth `returnTo` sanitized | — (good) | `safeReturnTo` in `lib/favourites.ts` |
| Server Action CSRF | INFORMATIONAL | Relies on Next.js Server Action origin checks (**inferred**, not re-proven here) |
| GraphQL errors may include Shopify messages in CAA path | LOW | `customerAccountFetch` concatenates GraphQL error messages |
| Favourites product IDs in sessionStorage intent | LOW | Same-origin; not secret |
| No security headers config in `next.config.ts` | LOW | CSP/HSTS typically at Vercel/CDN — **not verified** in repo |
| Account routes not in robots `disallow` | LOW | Only `/cart`, `/api/` disallowed — account pages may be crawlable if linked while logged-out redirects |
| Logging | INFORMATIONAL | Some `console.error` on authorize failures |

**CRITICAL / HIGH:** None verified in current code for the classic checkout redirect / JSON-LD breakout issues — both appear fixed.

---

# 12. Next.js Architecture

| Feature | Usage |
|---------|--------|
| Server Components | Default for pages/layouts |
| Client Components | Interactive cart, variants, filters, favourites, header |
| Server Actions | Cart, addresses, profile, favourites |
| Route Handlers | OAuth, search API, cart clear |
| Suspense | Header/footer chrome (`site-shell.tsx`) |
| Cache Components | `cacheComponents: true` in `next.config.ts` |
| `"use cache"` | `getNavCatalog` |
| Metadata | Root + product/collection/search |
| `not-found` | `app/not-found.tsx` |
| `error.tsx` | **Missing** |
| Middleware | **Missing** |
| Images | `next/image` + Shopify CDN remotePatterns |

## `/_not-found` prerender failure (explained, not fixed)

With **Cache Components**, Next prerenders a synthetic `/_not-found` route that **inherits the root layout**. If the root layout (or chrome it renders) reads **`cookies()` / uncached `fetch`** outside `<Suspense>`, build fails with “uncached or runtime data during prerendering” on `/_not-found`.

**Current code intent (verified):** `app/components/site-shell.tsx` comment states root chrome must stay prerenderable; cookie-bound `SiteHeader` and catalog footer are wrapped in `<Suspense>` with deterministic fallbacks.

**Cannot verify without running `next build` in this audit** whether the failure is fully gone in CI/local. Architecturally the Suspense split is the correct mitigation.

---

# 13. Caching & Performance

| Data | Strategy | Should be |
|------|----------|-----------|
| Catalog / PDP / collections | `revalidate: 120` | Cached with bounded staleness ✓ |
| Nav catalog | `"use cache"` + `cacheLife("minutes")` | Cached ✓ |
| Predictive search | `revalidate: 60` | Short cache OK |
| Cart | `no-store` | Always dynamic ✓ |
| CAA | `no-store` | Always dynamic ✓ |
| Header cart count | Per-request getCart | Correct; cost = extra Storefront call |

**Risks:** Duplicate catalog fetches across layout/page (partially mitigated by cache); favourites `nodes` chunking; collection infinite scroll hits `/api/catalog`. No explicit `revalidateTag` webhook pipeline — catalog freshness is time-based only.

---

# 14. SEO

| Item | Status |
|------|--------|
| Root metadata + OG | Yes (`app/layout.tsx`) |
| Product title/description/canonical/OG image | Yes (`generateMetadata` on PDP) |
| Collection metadata | Yes |
| JSON-LD Product | Yes, escaped |
| Sitemap | Dynamic products/collections (`app/sitemap.ts`) if `SITE_URL` set |
| Robots | Allow `/`, disallow cart/api |
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
| Null/expired cart | null handling + recreate / `/cart/clear` |
| CAA 401 | Redirect refresh |
| Favourites metafield denied | Friendly toast string in `app/favourites/actions.ts` |
| Route-level React error | **No `error.tsx`** — weaker resilience |

Graceful for cart commerce paths; weaker for unexpected RSC render throws.

---

# 16. Testing

| Artifact | Type | Touches Shopify? |
|----------|------|------------------|
| `scripts/audit-unit.ts` | Automated asserts (run via `npx tsx`) | No — checkout URL, money, sale % |
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
| Secrets / redirects / cookies | Solid baseline |
| Caching | Acceptable; no webhook invalidation |
| Reliability | Good cart recovery; missing error boundaries |
| SEO | MVP solid |
| Deploy | Vercel-oriented; `.env.example` complete; **no** `vercel.json` in repo |
| Buyer identity / Markets / i18n | Not production-complete for multi-market brands |

**Production-readiness score: 6.5 / 10** — shippable as a branded headless MVP with known Admin prerequisites; not yet “enterprise catalog” complete.

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

## Not demonstrated yet (verified absent)

- Admin GraphQL API / custom apps  
- Webhooks / event-driven revalidation  
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
| Headless Shopify Developer | **Very high** | Markets, webhook revalidation, buyer identity |
| Shopify App Developer | Low | No Admin API app, OAuth app install, extensions |
| Shopify Full-Stack Developer | Med–High | Add Admin/webhooks or lightweight app backend |
| Shopify Solutions Engineer | High | Great demo architecture; add multi-market + integration story |

---

# 21. Highest-Value Improvements

Ranked for **Shopify expertise signal**, not feature count.

### Priority 1 — Cart buyer identity after login
- **What:** Attach CAA customer to cart (`buyerIdentity` / related Cart APIs).  
- **Why:** Closes the guest→member commerce gap interviewers probe.  
- **Concept:** Authenticated cart / checkout association.  
- **Difficulty:** Medium. **Admin:** mostly API. **Value:** Very high.

### Priority 2 — Webhook-driven catalog revalidation
- **What:** App/webhook receiver → `revalidateTag` / path for products/collections.  
- **Why:** Shows production cache invalidation literacy.  
- **Concept:** Admin webhooks + Next cache.  
- **Difficulty:** Medium. **Admin:** webhook registration. **Value:** High.

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
| Customer Account API | **Already done** — deepen with buyer identity |
| Customer orders | **Already done** |
| Admin GraphQL | Yes if targeting app/full-stack roles |
| Webhooks | **Yes** (Priority 2) |
| Functions | Optional; heavy for portfolio ROI |
| Metaobjects | Nice for CMS story; medium value |
| Markets | If multi-region narrative needed |
| Advanced caching | Pair with webhooks |
| Search | **Already done** (predictive + search) |
| Wishlist | **Already done** (metafield) |

**Do not add Prisma/Postgres** just to mirror customers/orders.

---

# 22. Interview Explanation

## Explain this project to me like I'm preparing for an interview

**Customer opens the website.** The request hits a Next.js App Router app. The root layout renders `SiteShell`: announcement bar, a Suspense-wrapped header (so cookie/cart reads don’t block the static shell), page content, and footer. Nav links come from cached Storefront probes (`getNavCatalog`).

**Browse products.** Home and collection routes call `shopifyFetch` against Storefront API 2026-10 with the server-side Storefront access token. Products arrive as GraphQL connections (edges/nodes). We map them into typed `ProductListItem`s with images, price range, tags, and a page of variants. Collections can apply Shopify’s `ProductFilter`s and sort keys; the UI syncs filters to the URL.

**Select a variant.** On the PDP, `getProductByHandle` loads richer fields (up to 100 variants). `VariantSelector` is a client component: it picks an available variant GID and quantity.

**Add to Shopify cart.** Clicking add calls Server Action `addItem`. That reads httpOnly cookie `shopify-cart-id`. If missing or invalid, it `cartCreate`s, then `cartLinesAdd` with `merchandiseId` = variant GID. The cart id is stored httpOnly for 30 days. Cart mutations use `cache: "no-store"` so we never serve a stale cart from Next’s fetch cache.

**Cart persistence / update.** `/cart` loads the cart by id, shows lines, discounts, and costs from Shopify. Quantity/remove/discount Server Actions call `cartLinesUpdate` / `Remove` / `cartDiscountCodesUpdate`, then revalidate the cart path.

**Checkout.** Shopify returns `checkoutUrl` on the cart. We validate it is HTTPS and on an allowlisted host (`checkout.shopify.com`, our myshopify domain, or `SITE_URL` host) on the server and again in `CheckoutButton` before `window.location.assign`. From that moment, **payment and order creation are 100% Shopify-hosted**. Next does not process cards.

**Login → Customer Account API → orders.** “Account” starts OAuth PKCE (`/account/authorize`): we store state/verifier/(returnTo) in an encrypted cookie, send the user to Shopify’s authorization endpoint, then `/account/callback` exchanges the code for tokens and seals them in `zj-ca-session`. Protected pages call Customer Account GraphQL with `Authorization: <access_token>` (not Bearer — per this integration). We load profile, orders, addresses, and can read/write `custom.favourites` JSON metafield for the wishlist. Login intents can return the user to the previous page and auto-favourite a product, or land on `/account/favourites`.

**What I would say about expertise:** This isn’t a theme — it’s a real headless commerce BFF pattern: Shopify owns commerce truth; Next owns UX, session glue, and security boundaries (tokens, checkout redirects, XSS-safe JSON-LD).

---

# 23. Final Verdict

This repository is a **credible, interview-ready headless Shopify storefront** with unusually strong coverage for its size: Storefront catalog/cart/checkout **plus** Customer Account API, favourites metafields, and deliberate security fixes around checkout redirects and JSON-LD.

It will convince most Shopify employers you understand **headless Storefront architecture**, not merely Liquid themes. To push from “strong portfolio MVP” to “production engineer / solutions lead,” prioritize **buyer identity**, **webhook revalidation**, and **tighter automated tests** — not a customer database.

**Overall: ship it on the portfolio, demo the live checkout + account login, and prepare the interview narrative in §22.**

---

*End of audit. Generated from repository inspection on 2026-10-28. Shopify Admin configuration and live payment rails were not directly verified.*
